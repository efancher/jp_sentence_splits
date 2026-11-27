/**
 * Re-cut a book's existing reference clips with forced-alignment boundary
 * refinement (the same step new mined clips get at commit time — see
 * server/youtube-mining/app/boundary_refine.py).
 *
 * For every live `reference_audio` row of the book that records its source
 * URL and span, ask the mining API's `POST /source-audio/clip` to cut that
 * span *with the sentence text attached*; the service force-aligns the text,
 * snaps the cut to the first/last spoken word and reports how far it moved
 * plus any flags (held-sound, large-shift, ...). Cut points that the aligner
 * could not vouch for come back "unchanged"/"skipped" and are left alone.
 *
 * Only clips that move by at least --min-shift ms (default 150) and carry no
 * flags are replaced; --include-flagged also replaces flagged ones (large
 * shifts, held sounds), which are always listed for a human look.
 *
 * Replacement writes a NEW `audio_refine_*` row (new id + storage path, so
 * devices that cached the old blob re-fetch) whose source span is the refined
 * cut — a re-run therefore finds ~0 shift and skips — and soft-deletes the
 * old row. The old row's alignment/manual trim don't carry over; run
 * "Precompute word audio alignment" afterwards. Old blobs are kept.
 *
 * Needs the mining API (MINING_API_BASE, default the tailnet service) and the
 * source audio cached or re-downloadable (a bot-blocked uncached YouTube
 * source fails alone). Dry-run by default; --apply to write.
 *
 * Usage: npx tsx scripts/refine-reference-clip-boundaries.ts --book <id> [--apply]
 *          [--min-shift 150] [--include-flagged] [--limit N]
 */
import { hashString } from '../src/lib/ids';
import { uploadReferenceClip } from './lib/referenceAudioStorage';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const API_BASE = (process.env.MINING_API_BASE ??
  'https://codex-dev.tailfbd89c.ts.net/youtube-mining').replace(/\/+$/, '');

type Row = Record<string, unknown>;

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function postJson(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}`;

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const bookId = arg(argv, '--book');
  if (!bookId) throw new Error('--book <id> is required');
  const minShift = Number(arg(argv, '--min-shift') ?? 150);
  const includeFlagged = argv.includes('--include-flagged');
  const limit = Number(arg(argv, '--limit') ?? Infinity);

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const audioAll = await fetchAll(
    supabase,
    'reference_audio',
    'id, book_id, sentence_id, source_id, source_sentence_id, source_title, source_url, storage_path, source_start_ms, source_end_ms, deleted_at',
    user.id,
    (r) => r,
  );
  const live = audioAll.filter((a) => !a.deleted_at && a.book_id === bookId);
  const candidates = live
    .filter(
      (a) =>
        a.source_url &&
        a.storage_path &&
        a.source_start_ms != null &&
        a.source_end_ms != null &&
        Number(a.source_end_ms) > Number(a.source_start_ms),
    )
    .sort((a, b) => Number(a.source_start_ms) - Number(b.source_start_ms))
    .slice(0, Number.isFinite(limit) ? limit : undefined);
  const noSource = live.length - candidates.length;

  const sentences = await fetchAll(supabase, 'sentences', 'id, japanese, deleted_at', user.id, (r) => r);
  const japaneseById = new Map(sentences.map((s) => [String(s.id), String(s.japanese ?? '')]));

  console.log(
    `${candidates.length} clip(s) with a known source span` +
      (noSource > 0 && !Number.isFinite(limit) ? `, ${noSource} skipped (no source URL/span)` : '') +
      `; min shift ${minShift} ms${includeFlagged ? ', flagged clips included' : ''}.`,
  );

  const counts = { replaced: 0, wouldReplace: 0, small: 0, flagged: 0, unchanged: 0, failed: 0 };
  for (const [i, a] of candidates.entries()) {
    const text = japaneseById.get(String(a.sentence_id))?.trim();
    const label = `[${i + 1}/${candidates.length}] ${String(a.id).slice(-12)} ${(text ?? '').slice(0, 22)}`;
    if (!text) {
      console.log(`${label}  skip (no sentence text)`);
      continue;
    }
    let clip: Row | undefined;
    try {
      clip = (
        await postJson('/source-audio/clip', {
          url: a.source_url,
          cuts: [{ startMs: Number(a.source_start_ms), endMs: Number(a.source_end_ms), japanese: text }],
        })
      ).clips?.[0];
    } catch (error) {
      console.log(`${label}  FAILED ${error instanceof Error ? error.message.slice(0, 140) : String(error)}`);
      counts.failed += 1;
      continue;
    }
    const info = clip?.boundaryRefine as
      | { status: string; flags: string[]; shiftStartMs: number; shiftEndMs: number; reason?: string }
      | undefined;
    if (!clip?.audioBase64 || !info) {
      console.log(`${label}  FAILED no refinement info (is MINING_REFINE_BOUNDARIES off?)`);
      counts.failed += 1;
      continue;
    }
    if (info.status !== 'refined') {
      console.log(`${label}  unchanged (${info.status}: ${info.reason ?? info.flags.join(',')})`);
      counts.unchanged += 1;
      continue;
    }
    const shift = Math.max(Math.abs(info.shiftStartMs), Math.abs(info.shiftEndMs));
    const desc =
      `start ${signed(info.shiftStartMs)} ms, end ${signed(info.shiftEndMs)} ms` +
      (info.flags.length ? ` [${info.flags.join(',')}]` : '');
    if (shift < minShift) {
      console.log(`${label}  fine as is (${desc})`);
      counts.small += 1;
      continue;
    }
    if (info.flags.length > 0 && !includeFlagged) {
      console.log(`${label}  REVIEW, not replaced (${desc})`);
      counts.flagged += 1;
      continue;
    }
    if (!apply) {
      console.log(`${label}  would replace (${desc})`);
      counts.wouldReplace += 1;
      continue;
    }

    try {
      const bytes = Buffer.from(String(clip.audioBase64), 'base64');
      const audioId = `audio_refine_${hashString(String(a.id))}`;
      const storagePath = `${user.id}/${bookId}/${audioId}.m4a`;
      const { error: upErr } = await uploadReferenceClip(supabase, storagePath, bytes, {
        contentType: String(clip.mimeType ?? 'audio/mp4'),
        upsert: true,
      });
      if (upErr) throw new Error(`upload ${storagePath}: ${upErr.message}`);
      const { error: insErr } = await supabase.from('reference_audio').upsert(
        {
          id: audioId,
          owner_id: user.id,
          book_id: bookId,
          sentence_id: a.sentence_id,
          source_id: a.source_id,
          source_sentence_id: a.source_sentence_id,
          source_title: a.source_title,
          source_url: a.source_url,
          storage_path: storagePath,
          mime_type: clip.mimeType ?? 'audio/mp4',
          duration_ms: clip.durationMs,
          size_bytes: bytes.length,
          source_start_ms: clip.cutStartMs,
          source_end_ms: clip.cutEndMs,
        },
        { onConflict: 'id' },
      );
      if (insErr) throw new Error(`insert ${audioId}: ${insErr.message}`);
      // Soft-delete, never raw DELETE — a hard delete emits no sync_event.
      const { error: delErr } = await supabase
        .from('reference_audio')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', a.id);
      if (delErr) throw new Error(`soft-delete ${a.id}: ${delErr.message}`);
      console.log(`${label}  replaced (${desc})`);
      counts.replaced += 1;
    } catch (error) {
      console.log(`${label}  FAILED ${error instanceof Error ? error.message.slice(0, 140) : String(error)}`);
      counts.failed += 1;
    }
  }

  console.log(
    `\n${apply ? 'Done' : 'Preview'}: ${apply ? `${counts.replaced} replaced` : `${counts.wouldReplace} would be replaced`}, ` +
      `${counts.small} already fine, ${counts.flagged} flagged for review, ` +
      `${counts.unchanged} not trustworthy, ${counts.failed} failed.`,
  );
  if (!apply && counts.wouldReplace > 0) console.log('Run with apply to write.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
