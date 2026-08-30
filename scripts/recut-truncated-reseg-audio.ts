/**
 * One-off repair: the 2026-08-29 `backfill-resegment-audio.ts` run on
 * "Easy Japanese Drama: After Work" left ~14–18 `audio_reseg_*` reference
 * clips badly truncated — the file is far shorter than the video span it
 * claims to cover, so the sentence audio cuts off mid-word. Root cause was
 * `concatCut` (src/lib/resegmentPlan.ts) being fed wrong parent clips /
 * cue timings by `/resegment`, so the cut window collapsed.
 *
 * `remine-silent-shadowing-audio.ts` would fix these too, but its only
 * source of truth is a fresh yt-dlp download and YouTube now bot-blocks the
 * datacenter mining box. This script needs no network beyond Supabase: the
 * *original* per-fragment reference clips from the pre-resegmentation import
 * are still in Storage (the reseg backfill only soft-deleted their rows),
 * and each one covers exactly [source_start_ms, source_end_ms] of the video
 * timeline 1:1 (file duration == span, no padding). So for every truncated
 * sentence we find the original fragment clip(s) that overlap its span and
 * re-cut locally with ffmpeg.
 *
 * Truncation test: span (source_end_ms - source_start_ms) >= --min-span-ms
 * and duration_ms / span < --truncated-ratio. The re-cut clip keeps the
 * same source timings, so its ratio lands near 1 and a re-run won't
 * re-flag it. Idempotent otherwise: writes NEW `audio_remine_*` rows (new
 * ids + storage paths) and soft-deletes the truncated `audio_reseg_*` ones
 * — an in-place update would not reach devices that already cached the bad
 * blob (sync keeps the local blob on a reference_audio update).
 *
 * Needs ffmpeg + ffprobe on PATH. Dry-run by default; --apply to write.
 *
 * Usage:
 *   npx tsx scripts/recut-truncated-reseg-audio.ts [--apply] \
 *     [--book <id>] [--truncated-ratio 0.55] [--min-span-ms 1000]
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { concatCut } from '../src/lib/resegmentPlan';
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const AUDIO_BUCKET = 'reference-audio';
const RESEG_PREFIX = 'audio_reseg_';
const REMINE_PREFIX = 'audio_remine_';
const DEFAULT_BOOK_ID = 'book_30cac126-7197-4dd8-934f-53a0798c2326'; // After Work

// Breathing room around the cut, matched loosely to the mining clip.py
// values but smaller — we are slicing out of an already-trimmed clip.
const START_PAD_MS = 200;
const END_PAD_MS = 200;
const FADE_MS = 20;
const MAX_SILENT_DB = -50;

interface AudioRow {
  id: string;
  sentence_id: string;
  book_id: string;
  source_id: string;
  source_sentence_id: string;
  source_title: string;
  source_url: string | null;
  storage_path: string | null;
  duration_ms: number;
  source_start_ms: number | null;
  source_end_ms: number | null;
  deleted_at: string | null;
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function run(bin: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function ffprobeDurationMs(path: string): number {
  const r = run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path,
  ]);
  if (r.status !== 0) throw new Error(`ffprobe failed on ${path}: ${r.stderr.slice(-300)}`);
  const d = Number((JSON.parse(r.stdout) as { format?: { duration?: string } }).format?.duration);
  if (!Number.isFinite(d)) throw new Error(`ffprobe gave no duration for ${path}`);
  return Math.max(1, Math.round(d * 1000));
}

/** max_volume in dB via ffmpeg volumedetect; ~-91 dB means digital silence. */
function maxVolumeDb(path: string): number {
  const r = run('ffmpeg', [
    '-hide_banner', '-nostdin', '-i', path, '-af', 'volumedetect', '-f', 'null', '-',
  ]);
  const m = `${r.stdout}${r.stderr}`.match(/max_volume:\s*(-?[\d.]+) dB/);
  if (!m) throw new Error(`could not read max_volume:\n${r.stderr.slice(-400)}`);
  return Number(m[1]);
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const bookId = arg(argv, '--book') ?? DEFAULT_BOOK_ID;
  const truncatedRatio = Number(arg(argv, '--truncated-ratio') ?? 0.55);
  const minSpanMs = Number(arg(argv, '--min-span-ms') ?? 1000);

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const scratch = mkdtempSync(join(tmpdir(), 'recut-'));

  try {
    const { data: book } = await supabase
      .from('books').select('id, title').eq('id', bookId).maybeSingle();
    if (!book) throw new Error(`book ${bookId} not found`);
    console.log(`=== ${book.title} (${bookId})`);

    const cols =
      'id, sentence_id, book_id, source_id, source_sentence_id, source_title, source_url, storage_path, duration_ms, source_start_ms, source_end_ms, deleted_at';

    // Truncated reseg clips (live only).
    const { data: resegData, error: resegErr } = await supabase
      .from('reference_audio').select(cols)
      .eq('book_id', bookId).eq('owner_id', user.id)
      .is('deleted_at', null).like('id', `${RESEG_PREFIX}%`);
    if (resegErr) throw new Error(`fetch reseg rows: ${resegErr.message}`);
    const truncated = (resegData as AudioRow[])
      .filter((r) => {
        const span = (r.source_end_ms ?? 0) - (r.source_start_ms ?? 0);
        return span >= minSpanMs && r.duration_ms / span < truncatedRatio;
      })
      .sort((a, b) => (a.source_start_ms ?? 0) - (b.source_start_ms ?? 0));
    console.log(`${truncated.length} truncated reseg clip(s)`);
    if (truncated.length === 0) return;

    // Original per-fragment clips (pre-reseg), incl. soft-deleted. Their
    // [source_start_ms, source_end_ms] == file extent, 1:1, no padding.
    const { data: fragData } = await supabase
      .from('reference_audio').select(cols)
      .eq('book_id', bookId).eq('owner_id', user.id)
      .not('id', 'like', `${RESEG_PREFIX}%`).not('id', 'like', `${REMINE_PREFIX}%`)
      .order('source_start_ms', { ascending: true });
    const frags = (fragData as AudioRow[]).filter(
      (f) => f.storage_path && f.source_start_ms != null && f.source_end_ms != null,
    );
    console.log(`${frags.length} original fragment clip(s) available as source`);

    const { data: sents } = await supabase
      .from('sentences').select('id, japanese')
      .in('id', [...new Set(truncated.map((r) => r.sentence_id))]);
    const textById = new Map((sents ?? []).map((s) => [String(s.id), String(s.japanese)]));

    const blobCache = new Map<string, string>();
    async function localCopy(fr: AudioRow): Promise<string> {
      const cached = blobCache.get(fr.id);
      if (cached) return cached;
      const { data: blob, error } = await supabase.storage
        .from(AUDIO_BUCKET).download(fr.storage_path!);
      if (error || !blob) throw new Error(`download ${fr.storage_path}: ${error?.message}`);
      const p = join(scratch, `${fr.id}.m4a`);
      writeFileSync(p, Buffer.from(await blob.arrayBuffer()));
      blobCache.set(fr.id, p);
      return p;
    }

    let written = 0;
    let skipped = 0;
    for (const t of truncated) {
      const jp = textById.get(t.sentence_id) ?? '(no text)';
      const s = t.source_start_ms!;
      const e = t.source_end_ms!;
      const span = e - s;
      const overlap = frags
        .filter((f) => f.source_start_ms! < e && f.source_end_ms! > s)
        .sort((a, b) => a.source_start_ms! - b.source_start_ms!);
      if (overlap.length === 0) {
        console.log(`  ! no source fragment overlaps ${s}-${e}: ${jp} — skipping`);
        skipped += 1;
        continue;
      }

      // Prefer a single fragment that fully contains the span.
      const covering = overlap.find(
        (f) => f.source_start_ms! <= s && f.source_end_ms! >= e,
      );
      const parents = covering ? [covering] : overlap;

      // Build the source file (single fragment, or a concat of the run).
      let srcPath: string;
      let totalMs: number;
      if (parents.length === 1) {
        srcPath = await localCopy(parents[0]!);
        totalMs = ffprobeDurationMs(srcPath);
      } else {
        const inPaths: string[] = [];
        for (const p of parents) inPaths.push(await localCopy(p));
        srcPath = join(scratch, `concat-${randomUUID().slice(0, 8)}.m4a`);
        const filter =
          inPaths.map((_, i) => `[${i}:a]`).join('') +
          `concat=n=${inPaths.length}:v=0:a=1[a]`;
        const cc = run('ffmpeg', [
          '-y', '-nostdin',
          ...inPaths.flatMap((p) => ['-i', p]),
          '-filter_complex', filter, '-map', '[a]',
          '-c:a', 'aac', '-b:a', '192k', srcPath,
        ]);
        if (cc.status !== 0) throw new Error(`concat failed for "${jp}": ${cc.stderr.slice(-300)}`);
        totalMs = ffprobeDurationMs(srcPath);
      }

      // Map the [s, e] video-timeline span onto the source file.
      const mapped = concatCut(s, e, parents.map((p) => ({
        startMs: p.source_start_ms!,
        endMs: p.source_end_ms!,
        durationMs: p.source_end_ms! - p.source_start_ms!,
      })));
      const cutStart = Math.max(0, mapped.startMs - START_PAD_MS);
      const cutEnd = Math.min(totalMs, mapped.endMs + END_PAD_MS);
      const durS = (cutEnd - cutStart) / 1000;
      if (durS <= 0.1) {
        console.log(`  ! degenerate cut ${cutStart}-${cutEnd}ms for ${jp} — skipping`);
        skipped += 1;
        continue;
      }
      const fadeS = Math.min(FADE_MS / 1000, durS / 4);
      const out = join(scratch, `out-${randomUUID().slice(0, 8)}.m4a`);
      const args = [
        '-y', '-nostdin',
        '-ss', (cutStart / 1000).toFixed(3),
        '-i', srcPath,
        '-t', durS.toFixed(3),
        '-vn', '-c:a', 'aac', '-b:a', '192k',
      ];
      if (fadeS > 0) {
        args.push('-af', `afade=t=out:st=${Math.max(0, durS - fadeS).toFixed(3)}:d=${fadeS.toFixed(3)}`);
      }
      args.push(out);
      const cut = run('ffmpeg', args);
      if (cut.status !== 0) throw new Error(`cut failed for "${jp}": ${cut.stderr.slice(-300)}`);

      const newMs = ffprobeDurationMs(out);
      const db = maxVolumeDb(out);
      const bytes = readFileSync(out);
      const ok = db >= MAX_SILENT_DB && newMs >= span * 0.6;
      const parentDesc =
        parents.length === 1 ? parents[0]!.id : `${parents.length}×concat`;
      console.log(
        `  ${ok ? '+' : '!'} ${jp}\n      was ${t.duration_ms}ms → ${newMs}ms  ` +
          `(span ${span}ms, ${db.toFixed(1)}dB, src ${parentDesc})`,
      );
      if (!ok) {
        console.log(`      guard failed (silent or still short) — leaving old row`);
        skipped += 1;
        continue;
      }
      if (!apply) continue;

      const audioId = `${REMINE_PREFIX}${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const path = `${user.id}/${bookId}/${audioId}.m4a`;
      const { error: upErr } = await supabase.storage
        .from(AUDIO_BUCKET).upload(path, bytes, { contentType: 'audio/mp4', upsert: true });
      if (upErr) throw new Error(`upload ${path}: ${upErr.message}`);

      const { error: insErr } = await supabase.from('reference_audio').insert({
        id: audioId,
        owner_id: user.id,
        book_id: bookId,
        sentence_id: t.sentence_id,
        source_id: t.source_id,
        source_sentence_id: `${t.source_id}:remine-${t.sentence_id}`,
        source_title: t.source_title,
        source_url: t.source_url,
        storage_path: path,
        mime_type: 'audio/mp4',
        duration_ms: newMs,
        size_bytes: bytes.length,
        source_start_ms: s,
        source_end_ms: e,
      });
      if (insErr) throw new Error(`insert ${audioId}: ${insErr.message}`);

      // Soft-delete, never raw DELETE — a hard delete emits no sync_event.
      const { error: delErr } = await supabase
        .from('reference_audio')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', t.id);
      if (delErr) throw new Error(`soft-delete ${t.id}: ${delErr.message}`);
      written += 1;
    }

    console.log(
      `\n${apply ? 'Done' : 'Dry run'}: ${apply ? written : truncated.length - skipped} ` +
        `clip(s) ${apply ? 're-cut and replaced' : 'would be re-cut'}, ${skipped} skipped.`,
    );
    if (!apply) console.log('Re-run with --apply to write.');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
