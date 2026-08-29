/**
 * One-off: restore shadowing audio to *Easy Japanese Drama: After Work*,
 * which lost it when the book was re-segmented on 2026-08-29.
 *
 * `applyResegmentation` re-split the sentences but never carried the
 * per-fragment reference audio across (fixed forward in that function).
 * The 92 `reference_audio` rows still point at the now-retired fragment
 * sentences and — crucially — still carry accurate `source_start_ms` /
 * `source_end_ms` on the video timeline. So we can reconstruct: feed the
 * retired fragments' text + timing back through `/resegment` to get the new
 * cues with real timings, match each to a current sentence, then cut its
 * clip out of the old fragment clip(s) it overlaps via `/reclip`.
 *
 * Dry-run by default; --apply required to write (Storage uploads +
 * `reference_audio` inserts + soft-deleting the orphan rows). Idempotent:
 * a current sentence that already has non-deleted audio is skipped, and an
 * already-soft-deleted orphan row is left alone.
 *
 * Needs the mining service reachable (tailnet). Override its URL with
 * MINING_API_BASE if not the default.
 *
 * Usage: npx tsx scripts/backfill-resegment-audio.ts [--apply] [--book <id>]
 */
import { randomUUID } from 'node:crypto';

import { normalizeSentenceKey } from '../src/lib/normalize';
import { concatCut } from '../src/lib/resegmentPlan';
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const DEFAULT_BOOK_ID = 'book_30cac126-7197-4dd8-934f-53a0798c2326';
const API_BASE = (process.env.MINING_API_BASE ??
  'https://codex-dev.tailfbd89c.ts.net/youtube-mining').replace(/\/$/, '');
const AUDIO_BUCKET = 'reference-audio';

interface AudioRow {
  deleted_at?: string | null;
  id: string;
  sentence_id: string;
  source_id: string;
  source_sentence_id: string;
  source_title: string;
  source_url: string | null;
  storage_path: string | null;
  mime_type: string;
  duration_ms: number;
  source_start_ms: number;
  source_end_ms: number;
}

interface ResegmentedCue {
  japanese: string;
  startMs: number;
  endMs: number;
  sourceIndexes: number[];
}

function bookArg(argv: string[]): string {
  const i = argv.indexOf('--book');
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : DEFAULT_BOOK_ID;
}

const asParent = (a: AudioRow) => ({
  startMs: a.source_start_ms,
  endMs: a.source_end_ms,
  durationMs: a.duration_ms,
});

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`${path} -> ${resp.status}: ${(await resp.text()).slice(0, 400)}`);
  }
  return (await resp.json()) as T;
}

const RESEG_ID_PREFIX = 'audio_reseg_';

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const redo = argv.includes('--redo');
  const bookId = bookArg(argv);

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const { data: book, error: bookErr } = await supabase
    .from('books')
    .select('id, title')
    .eq('id', bookId)
    .single();
  if (bookErr || !book) throw new Error(`Book ${bookId} not found: ${bookErr?.message}`);
  console.log(`Book: ${book.title}`);

  // Optionally wipe a previous run's output so this one starts clean.
  if (redo) {
    const { data: prior } = await supabase
      .from('reference_audio')
      .select('id, storage_path')
      .eq('book_id', bookId)
      .like('id', `${RESEG_ID_PREFIX}%`);
    const priorRows = prior ?? [];
    console.log(`--redo: clearing ${priorRows.length} prior backfill row(s).`);
    if (apply && priorRows.length) {
      const paths = priorRows.map((r) => r.storage_path).filter(Boolean) as string[];
      if (paths.length) await supabase.storage.from(AUDIO_BUCKET).remove(paths);
      const { error } = await supabase
        .from('reference_audio')
        .delete()
        .in('id', priorRows.map((r) => r.id));
      if (error) throw new Error(`--redo delete: ${error.message}`);
    }
  }

  // 1. The original per-fragment clips (anything not from a prior backfill
  //    run), including ones a previous run soft-deleted, ordered along the
  //    video. Their source_start_ms/source_end_ms are the trustworthy bit.
  const { data: audioData, error: audioErr } = await supabase
    .from('reference_audio')
    .select(
      'id, sentence_id, source_id, source_sentence_id, source_title, source_url, storage_path, mime_type, duration_ms, source_start_ms, source_end_ms, deleted_at',
    )
    .eq('book_id', bookId)
    .eq('owner_id', user.id)
    .not('id', 'like', `${RESEG_ID_PREFIX}%`)
    .order('source_start_ms', { ascending: true });
  if (audioErr) throw new Error(`Fetch reference_audio: ${audioErr.message}`);
  const audio = (audioData ?? []) as AudioRow[];
  console.log(`Original per-fragment clips: ${audio.length}`);
  if (audio.length === 0) return;

  // 2. The retired fragments' text (includes soft-deleted rows).
  const { data: fragData } = await supabase
    .from('sentences')
    .select('id, japanese')
    .in('id', [...new Set(audio.map((a) => a.sentence_id))]);
  const fragText = new Map((fragData ?? []).map((s) => [String(s.id), String(s.japanese)]));

  const input = audio.map((a) => ({
    japanese: fragText.get(a.sentence_id) ?? '',
    startMs: a.source_start_ms,
    endMs: a.source_end_ms,
  }));
  if (input.some((s) => !s.japanese)) {
    throw new Error('Some fragment sentences have no text — cannot rebuild timings.');
  }

  // 3. Re-segment to recover accurate per-sentence timings.
  const cues = await postJson<ResegmentedCue[]>('/resegment', {
    sentences: input,
    merge: true,
    split: true,
    generateKana: false,
  });
  console.log(`Re-segmented into ${cues.length} cues.`);

  // 4. Current sentences of the book.
  const { data: bs } = await supabase
    .from('book_sentences')
    .select('sentence_id')
    .eq('book_id', bookId)
    .is('deleted_at', null);
  const currentIds = (bs ?? []).map((r) => String(r.sentence_id));
  const { data: curSents } = await supabase
    .from('sentences')
    .select('id, japanese')
    .in('id', currentIds);
  const currentByKey = new Map(
    (curSents ?? []).map((s) => [normalizeSentenceKey(String(s.japanese)), String(s.id)]),
  );

  /**
   * Exact normalized match, else a unique sentence whose key is a suffix of
   * the cue's (the re-segment review UI lets the user trim a leading
   * `[音楽]` / `え、` filler that the old fragment text still carried).
   */
  function matchCurrent(japanese: string): string | undefined {
    const key = normalizeSentenceKey(japanese);
    const exact = currentByKey.get(key);
    if (exact) return exact;
    const suffixHits = [...currentByKey.entries()].filter(
      ([k]) => k.length >= 4 && key.endsWith(k),
    );
    return suffixHits.length === 1 ? suffixHits[0][1] : undefined;
  }

  // Which current sentences already have audio (idempotency).
  const { data: liveAudio } = await supabase
    .from('reference_audio')
    .select('sentence_id')
    .eq('book_id', bookId)
    .is('deleted_at', null)
    .in('sentence_id', currentIds);
  const haveAudio = new Set((liveAudio ?? []).map((r) => String(r.sentence_id)));

  // 5. Group cues by the fragment clips they descend from. When the same
  //    line is spoken more than once, keep only the first cue for that
  //    sentence — one reference clip per sentence.
  const groups = new Map<string, ResegmentedCue[]>();
  const unmatched: string[] = [];
  const planned = new Set<string>();
  for (const cue of cues) {
    const targetId = matchCurrent(cue.japanese);
    if (!targetId) {
      unmatched.push(cue.japanese);
      continue;
    }
    if (haveAudio.has(targetId) || planned.has(targetId)) continue;
    planned.add(targetId);
    const key = cue.sourceIndexes.join(',');
    const bucket = groups.get(key);
    if (bucket) bucket.push(cue);
    else groups.set(key, [cue]);
  }

  const plannedCount = [...groups.values()].reduce((n, g) => n + g.length, 0);
  console.log(
    `\nCues matched to a current sentence needing audio: ${plannedCount}` +
      ` (in ${groups.size} clip group(s))`,
  );
  console.log(`Cues with no matching current sentence: ${unmatched.length}`);
  for (const u of unmatched) console.log(`  unmatched: ${u}`);
  const alreadyOk = currentIds.filter((id) => haveAudio.has(id)).length;
  console.log(`Current sentences that already have audio: ${alreadyOk} / ${currentIds.length}`);

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply.');
    return;
  }

  // 6. For each group: concat its fragment clips, cut each cue's slice.
  let written = 0;
  for (const [key, groupCues] of groups) {
    const parents = key.split(',').map((i) => audio[Number(i)]!);
    const clipsBase64: string[] = [];
    for (const p of parents) {
      if (!p.storage_path) throw new Error(`Clip ${p.id} has no storage_path`);
      const { data: blob, error } = await supabase.storage
        .from(AUDIO_BUCKET)
        .download(p.storage_path);
      if (error || !blob) throw new Error(`Download ${p.storage_path}: ${error?.message}`);
      clipsBase64.push(Buffer.from(await blob.arrayBuffer()).toString('base64'));
    }

    const cuts = groupCues.map((cue) =>
      concatCut(cue.startMs, cue.endMs, parents.map(asParent)),
    );
    const { clips } = await postJson<{
      clips: { audioBase64: string; mimeType: string; durationMs: number }[];
    }>('/reclip', { clipsBase64, cuts, trimSilence: true });

    const template = parents[0]!;
    for (let i = 0; i < groupCues.length; i += 1) {
      const cue = groupCues[i]!;
      const out = clips[i]!;
      const targetId = matchCurrent(cue.japanese)!;
      const bytes = Buffer.from(out.audioBase64, 'base64');
      const audioId = `audio_reseg_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const path = `${user.id}/${bookId}/${audioId}.m4a`;

      const { error: upErr } = await supabase.storage
        .from(AUDIO_BUCKET)
        .upload(path, bytes, { contentType: 'audio/mp4', upsert: true });
      if (upErr) throw new Error(`Upload ${path}: ${upErr.message}`);

      const { error: insErr } = await supabase.from('reference_audio').insert({
        id: audioId,
        owner_id: user.id,
        book_id: bookId,
        sentence_id: targetId,
        source_id: template.source_id,
        source_sentence_id: `${template.source_id}:reseg-${targetId}`,
        source_title: template.source_title,
        source_url: template.source_url,
        storage_path: path,
        mime_type: 'audio/mp4',
        duration_ms: out.durationMs,
        size_bytes: bytes.length,
        source_start_ms: cue.startMs,
        source_end_ms: cue.endMs,
      });
      if (insErr) throw new Error(`Insert reference_audio ${audioId}: ${insErr.message}`);
      written += 1;
      console.log(`  + ${cue.japanese}  (${out.durationMs}ms)`);
    }
  }

  // 7. Soft-delete the still-live orphan rows (pointing at a retired fragment).
  const currentIdSet = new Set(currentIds);
  const orphanIds = audio
    .filter((a) => !a.deleted_at && !currentIdSet.has(a.sentence_id))
    .map((a) => a.id);
  if (orphanIds.length) {
    const { error: delErr } = await supabase
      .from('reference_audio')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', orphanIds);
    if (delErr) throw new Error(`Soft-delete orphans: ${delErr.message}`);
  }

  console.log(
    `\nDone. ${written} clip(s) written, ${orphanIds.length} orphan row(s) retired.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
