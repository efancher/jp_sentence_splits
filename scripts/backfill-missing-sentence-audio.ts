/**
 * Cut reference audio for live book sentences that have none.
 *
 * Some mined sentences never got a clip (e.g. the last four sentences of Slow
 * Japanese Ep 7 — the import's clip step skipped them), so the learner sees
 * "No native audio" and the app's "Fetch audio" finds nothing in the cloud.
 * Each such sentence still carries its video span in its SHADOWING source
 * reference (`userNotes`: "Video position: 189.000–197.000 seconds"), and a
 * sibling sentence from the same source carries the source URL, so the clip
 * can be re-cut from the pristine source via the mining API's
 * `POST /source-audio/clip`.
 *
 * Only sentences with a live book membership, no live `reference_audio`, a
 * parseable span and a known source URL are touched; everything else is listed
 * as skipped. Writes a NEW `audio_fill_*` row (deterministic id, so a re-run
 * upserts the same row) and uploads the clip; nothing is deleted.
 *
 * Needs the mining API (MINING_API_BASE, default the tailnet service).
 * Dry-run by default; --apply to write.
 *
 * Usage: npx tsx scripts/backfill-missing-sentence-audio.ts [--apply] [--book <id>] [--sentence <id,id,...>]
 */
import { hashString } from '../src/lib/ids';
import { parseVideoSpanMs, sourceKeyOfCardId } from './lib/missingAudioPlan';
import { uploadReferenceClip } from './lib/referenceAudioStorage';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const API_BASE = (process.env.MINING_API_BASE ??
  'https://codex-dev.tailfbd89c.ts.net/youtube-mining').replace(/\/+$/, '');
const MIN_CLIP_RATIO = 0.8;

type Row = Record<string, unknown>;

async function postJson(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const bookArg = argv.includes('--book') ? argv[argv.indexOf('--book') + 1] : undefined;
  const sentenceArg = argv.includes('--sentence') ? new Set(argv[argv.indexOf('--sentence') + 1].split(',')) : undefined;
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const live = (row: Row) => !row.deleted_at;
  const memberships = (
    await fetchAll(supabase, 'book_sentences', 'id, book_id, sentence_id, deleted_at', user.id, (r) => r)
  ).filter((m) => live(m) && (!bookArg || m.book_id === bookArg));
  const audio = (
    await fetchAll(
      supabase,
      'reference_audio',
      'id, sentence_id, source_id, source_url, source_title, deleted_at',
      user.id,
      (r) => r,
    )
  ).filter(live);
  const hasAudio = new Set(audio.map((a) => String(a.sentence_id)));
  const missingIds = [...new Set(memberships.map((m) => String(m.sentence_id)))].filter((id) => !hasAudio.has(id) && (!sentenceArg || sentenceArg.has(id)));
  const bookOf = new Map(memberships.map((m) => [String(m.sentence_id), String(m.book_id)]));
  console.log(`${missingIds.length} live book sentence(s) have no clip${bookArg ? ` in ${bookArg}` : ''}.`);

  const sentences = (
    await fetchAll(supabase, 'sentences', 'id, japanese, source_references, deleted_at', user.id, (r) => r)
  ).filter((s) => live(s) && missingIds.includes(String(s.id)));

  // Source id (cardId prefix) -> URL/title/id, from any sibling clip of that source.
  const sourceInfo = new Map<string, { url: string; title: string; sourceId: string }>();
  for (const a of audio) {
    if (a.source_id && a.source_url) {
      sourceInfo.set(String(a.source_id), {
        url: String(a.source_url),
        title: String(a.source_title ?? ''),
        sourceId: String(a.source_id),
      });
    }
  }

  let done = 0;
  for (const s of sentences) {
    const refs = (s.source_references as Row[] | null) ?? [];
    const ref = refs.find((r) => r.cardType === 'SHADOWING') ?? refs[0];
    const label = `${s.id} ${String(s.japanese).slice(0, 24)}`;
    const span = ref ? parseVideoSpanMs(String(ref.userNotes ?? '')) : null;
    const sourceId = ref ? sourceKeyOfCardId(String(ref.cardId ?? '')) : null;
    const info = sourceId ? sourceInfo.get(sourceId) : undefined;
    if (!span || !info || !sourceId) {
      console.log(`  skip  ${label} (${!span ? 'no video span' : 'no known source URL'})`);
      continue;
    }
    const { startMs, endMs } = span;
    console.log(`  ${apply ? 'cut ' : 'would cut'} ${label}  ${startMs}-${endMs}ms of ${info.title}`);
    if (!apply) continue;

    const res = await postJson('/source-audio/clip', { url: info.url, cuts: [{ startMs, endMs }] });
    const clip = res.clips?.[0];
    if (!clip?.audioBase64 || !(clip.durationMs >= (endMs - startMs) * MIN_CLIP_RATIO)) {
      console.log(`    FAILED: clip missing or too short (${clip?.durationMs}ms for ${endMs - startMs}ms)`);
      continue;
    }
    const bytes = Buffer.from(clip.audioBase64, 'base64');
    const bookId = bookOf.get(String(s.id))!;
    const audioId = `audio_fill_${hashString(`${sourceId}:${s.id}`)}`;
    const storagePath = `${user.id}/${bookId}/${audioId}.m4a`;
    const { error: upErr } = await uploadReferenceClip(supabase, storagePath, bytes, {
      contentType: clip.mimeType ?? 'audio/mp4',
      upsert: true,
    });
    if (upErr) throw new Error(`upload ${storagePath}: ${upErr.message}`);
    const { error } = await supabase.from('reference_audio').upsert(
      {
        id: audioId,
        owner_id: user.id,
        book_id: bookId,
        sentence_id: s.id,
        source_id: info.sourceId,
        source_sentence_id: String(ref!.cardId).split(':')[1] ?? `fill-${s.id}`,
        source_title: info.title,
        source_url: info.url,
        storage_path: storagePath,
        mime_type: clip.mimeType ?? 'audio/mp4',
        duration_ms: clip.durationMs,
        size_bytes: bytes.length,
        source_start_ms: startMs,
        source_end_ms: endMs,
      },
      { onConflict: 'id' },
    );
    if (error) throw new Error(`upsert reference_audio ${audioId}: ${error.message}`);
    done += 1;
  }
  console.log(apply ? `\nCut and uploaded ${done} clip(s).` : '\nDry run — re-run with --apply to write.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
