/**
 * One-off repair: some shadowing books have reference-audio clips that are
 * digital silence (valid AAC container, ~2 kb/s, max_volume -91 dB) — no
 * sound in the Shadow player even though the timeline renders.
 *
 * Known affected (2026-08-30 audit):
 *   - "Basic Japanese drama : First Day at Work (N5-4)" — all 63 clips,
 *     from a .shadowing.zip import whose package audio was already silent.
 *   - "Easy Japanese Drama: After Work" — 27 `audio_reseg_*` clips from the
 *     2026-08-29 re-segmentation backfill (cut ranges that landed entirely
 *     in a silent region of the parent fragment clip).
 *
 * Fix: re-cut each broken sentence from the real source audio at its
 * stored source_start_ms/source_end_ms. Writes NEW reference_audio rows
 * (new ids + storage paths) and soft-deletes the silent ones — an in-place
 * update would not reach devices that already cached the silent blob (sync
 * keeps the existing local blob on a reference_audio update, see
 * src/sync/engine.ts).
 *
 * Two ways to get the source audio:
 *   1. Default: drive the youtube-mining `/jobs` API (fresh yt-dlp
 *      download). Fragile — YouTube throttles / serves silent streams to
 *      the datacenter-hosted mining box.
 *   2. --local-source <dir>: clip locally with ffmpeg from source files
 *      you've already downloaded (e.g. yt-dlp on a residential IP), one
 *      per video, named "<youtubeVideoId>.<ext>" (m4a/webm/opus/mp3/…).
 *      No mining service, no network beyond Supabase.
 *
 * Dry-run by default; --apply to write. Idempotent: a sentence that already
 * has a verified-audible non-deleted clip is skipped. --redo clears this
 * script's prior output (audio_remine_* rows) and restores the originals a
 * prior failed run soft-deleted.
 *
 * Needs ffmpeg + ffprobe on PATH. Override the mining URL with
 * MINING_API_BASE.
 *
 * Usage:
 *   npx tsx scripts/remine-silent-shadowing-audio.ts [--apply] [--redo] \
 *     [--book <id>] [--max-silent-db -50] [--local-source <dir>]
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const API_BASE = (process.env.MINING_API_BASE ??
  'https://codex-dev.tailfbd89c.ts.net/youtube-mining').replace(/\/$/, '');
const AUDIO_BUCKET = 'reference-audio';
const REMINE_ID_PREFIX = 'audio_remine_';

/** Books to sweep when --book isn't given. */
const DEFAULT_BOOK_IDS = [
  'book_a35bccf3-14ce-43d2-8d6f-8296e8dbffcd', // First Day at Work
  'book_30cac126-7197-4dd8-934f-53a0798c2326', // After Work
];

interface AudioRow {
  id: string;
  sentence_id: string;
  book_id: string;
  source_id: string;
  source_sentence_id: string;
  source_title: string;
  source_url: string | null;
  storage_path: string | null;
  mime_type: string;
  duration_ms: number;
  size_bytes: number | null;
  source_start_ms: number | null;
  source_end_ms: number | null;
}

type Supabase = Awaited<ReturnType<typeof createScriptSupabaseClient>>;

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`POST ${path} -> ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
  }
  return (await resp.json()) as T;
}

/**
 * max_volume in dB via ffmpeg volumedetect; ~-91 dB means digital silence.
 * volumedetect writes its report to stderr and ffmpeg exits 0, so we must
 * capture stderr on success too (spawnSync, not execFileSync — the latter
 * discards stderr unless the process fails). Throws if the report can't be
 * parsed, so a broken probe never silently passes the caller's guard.
 */
function maxVolumeDb(bytes: Buffer, scratch: string): number {
  const f = join(scratch, `probe-${randomUUID().slice(0, 8)}.m4a`);
  writeFileSync(f, bytes);
  try {
    const r = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-nostdin', '-i', f, '-af', 'volumedetect', '-f', 'null', '-'],
      { encoding: 'utf8' },
    );
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const m = out.match(/max_volume:\s*(-?[\d.]+) dB/);
    if (!m) throw new Error(`could not read max_volume from ffmpeg output:\n${out.slice(-400)}`);
    return Number(m[1]);
  } finally {
    rmSync(f, { force: true });
  }
}

async function waitForJob(jobId: string): Promise<void> {
  const deadline = Date.now() + 8 * 60_000;
  let lastStage = '';
  for (;;) {
    const resp = await fetch(`${API_BASE}/jobs/${jobId}`);
    if (!resp.ok) throw new Error(`GET /jobs/${jobId} -> ${resp.status}`);
    const job = (await resp.json()) as {
      status: string;
      stage: string;
      error?: string | null;
    };
    if (job.stage !== lastStage) {
      console.log(`    [${job.status}] ${job.stage}`);
      lastStage = job.stage;
    }
    // "ready" is enough — this repair supplies its own text + timings and
    // cuts via POST /jobs/{id}/clip, so a source with no fetchable
    // subtitle track (0 parsed cues) is fine.
    if (job.status === 'ready') return;
    if (job.status === 'error') throw new Error(`Mining job failed: ${job.error}`);
    if (Date.now() > deadline) throw new Error('Mining job timed out (8 min)');
    await sleep(3000);
  }
}

interface ClipResponse {
  sentenceId: string;
  audio: { durationMs: number };
}

interface JobEntry {
  row: AudioRow;
  japanese: string;
  startMs: number;
  endMs: number;
}

interface CutClip {
  bytes: Buffer;
  durationMs: number;
}

/** Produces one re-cut clip per sentence, from a mining job or a local file. */
interface ClipCutter {
  label: string;
  cut(entry: JobEntry): Promise<CutClip>;
  close?(): Promise<void>;
}

// Mirrors server/youtube-mining/app/clip.py so local cuts match the mining
// path's boundaries and encoding exactly.
const START_PAD_MS = 300;
const END_PAD_MS = 250;
const FADE_MS = 20;

function ffprobeDurationMs(path: string): number {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`ffprobe failed on ${path}: ${(r.stderr ?? '').slice(-300)}`);
  const duration = Number((JSON.parse(r.stdout) as { format?: { duration?: string } }).format?.duration);
  if (!Number.isFinite(duration)) throw new Error(`ffprobe gave no duration for ${path}`);
  return Math.max(1, Math.round(duration * 1000));
}

async function createMiningCutter(sourceUrl: string): Promise<ClipCutter> {
  console.log('  Creating mining job…');
  const { jobId } = await postJson<{ jobId: string }>('/jobs', { url: sourceUrl });
  await waitForJob(jobId);
  return {
    label: `mining job ${jobId}`,
    async cut(entry) {
      const clip = await postJson<ClipResponse>(`/jobs/${jobId}/clip`, {
        japanese: entry.japanese,
        startMs: entry.startMs,
        endMs: entry.endMs,
        generateKana: false,
      });
      const resp = await fetch(`${API_BASE}/jobs/${jobId}/clips/${clip.sentenceId}/audio`);
      if (!resp.ok) throw new Error(`fetch clip audio -> ${resp.status}`);
      return { bytes: Buffer.from(await resp.arrayBuffer()), durationMs: clip.audio.durationMs };
    },
    async close() {
      await fetch(`${API_BASE}/jobs/${jobId}`, { method: 'DELETE' }).catch(() => {});
    },
  };
}

function youtubeVideoId(url: string | null): string | undefined {
  return url?.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([\w-]{11})/)?.[1];
}

function createLocalCutter(sourcePath: string, scratch: string): ClipCutter {
  const mediaMs = ffprobeDurationMs(sourcePath);
  return {
    label: `local source ${basename(sourcePath)} (${(mediaMs / 1000).toFixed(0)}s)`,
    async cut(entry) {
      const adjStart = Math.max(0, entry.startMs - START_PAD_MS);
      const adjEnd = Math.min(entry.endMs + END_PAD_MS, mediaMs);
      if (adjEnd <= adjStart) throw new Error(`empty clip range for "${entry.japanese}"`);
      const durS = (adjEnd - adjStart) / 1000;
      const fadeS = FADE_MS > 0 ? Math.min(FADE_MS / 1000, durS / 4) : 0;
      const out = join(scratch, `cut-${randomUUID().slice(0, 8)}.m4a`);
      // -ss BEFORE -i: with output-side seeking the decoded frames keep
      // their ~adjStart timestamps and afade's st= (relative to 0) fades
      // the whole clip to silence. Same fix as clip.py in the mining
      // service.
      const args = [
        '-y',
        '-ss', (adjStart / 1000).toFixed(3),
        '-i', sourcePath,
        '-t', durS.toFixed(3),
        '-vn', '-c:a', 'aac', '-b:a', '192k',
      ];
      if (fadeS > 0) {
        args.push('-af', `afade=t=out:st=${Math.max(0, durS - fadeS).toFixed(3)}:d=${fadeS.toFixed(3)}`);
      }
      args.push(out);
      const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`ffmpeg cut failed: ${(r.stderr ?? '').slice(-300)}`);
      try {
        return { bytes: readFileSync(out), durationMs: ffprobeDurationMs(out) };
      } finally {
        rmSync(out, { force: true });
      }
    },
  };
}

/** Find "<dir>/<videoId>.<ext>" for a book's source video. */
function resolveLocalSource(dir: string, sourceUrl: string | null): string | undefined {
  if (!existsSync(dir)) throw new Error(`--local-source dir does not exist: ${dir}`);
  const vid = youtubeVideoId(sourceUrl);
  if (!vid) return undefined;
  const hit = readdirSync(dir).find((name) => name.startsWith(`${vid}.`));
  return hit ? join(dir, hit) : undefined;
}

async function remineBook(
  supabase: Supabase,
  userId: string,
  bookId: string,
  opts: {
    apply: boolean;
    redo: boolean;
    maxSilentDb: number;
    scratch: string;
    localSourceDir?: string;
  },
) {
  const { data: book } = await supabase
    .from('books')
    .select('id, title')
    .eq('id', bookId)
    .maybeSingle();
  if (!book) {
    console.log(`\n=== ${bookId}: book not found, skipping`);
    return;
  }
  console.log(`\n=== ${book.title} (${bookId})`);

  // Originals a prior run soft-deleted when it wrote its remine rows. Under
  // --redo we drop the remine rows and treat these as live again (restored
  // for real only under --apply; the detector below includes them either
  // way so a dry run shows the true post-redo plan).
  const restorableIds: string[] = [];
  if (opts.redo) {
    const { data: prior } = await supabase
      .from('reference_audio')
      .select('id, storage_path, sentence_id')
      .eq('book_id', bookId)
      .like('id', `${REMINE_ID_PREFIX}%`);
    const { data: orphaned } = await supabase
      .from('reference_audio')
      .select('id')
      .eq('book_id', bookId)
      .not('deleted_at', 'is', null)
      .not('id', 'like', `${REMINE_ID_PREFIX}%`)
      .in('sentence_id', [...new Set((prior ?? []).map((r) => r.sentence_id))]);
    restorableIds.push(...(orphaned ?? []).map((r) => String(r.id)));
    console.log(
      `  --redo: clearing ${prior?.length ?? 0} prior remine row(s), ` +
        `restoring ${restorableIds.length} soft-deleted original(s)`,
    );
    if (opts.apply && prior?.length) {
      const paths = prior.map((r) => r.storage_path).filter(Boolean) as string[];
      if (paths.length) await supabase.storage.from(AUDIO_BUCKET).remove(paths);
      // Soft-delete, never raw DELETE — a hard delete emits no sync_event,
      // so any device that already pulled these rows keeps them (and their
      // silent blobs) forever. See feedback_supabase_hard_delete_bypasses_sync.
      const { error } = await supabase
        .from('reference_audio')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', prior.map((r) => r.id));
      if (error) throw new Error(`--redo delete: ${error.message}`);
      if (restorableIds.length) {
        const { error: restoreErr } = await supabase
          .from('reference_audio')
          .update({ deleted_at: null })
          .in('id', restorableIds);
        if (restoreErr) throw new Error(`--redo restore: ${restoreErr.message}`);
      }
    }
  }

  const cols =
    'id, sentence_id, book_id, source_id, source_sentence_id, source_title, source_url, storage_path, mime_type, duration_ms, size_bytes, source_start_ms, source_end_ms';
  const { data: liveData, error: rowsErr } = await supabase
    .from('reference_audio')
    .select(cols)
    .eq('book_id', bookId)
    .eq('owner_id', userId)
    .is('deleted_at', null)
    .not('id', 'like', `${REMINE_ID_PREFIX}%`);
  if (rowsErr) throw new Error(`fetch reference_audio: ${rowsErr.message}`);
  const rows = [...((liveData ?? []) as AudioRow[])];
  if (restorableIds.length) {
    const { data: restored } = await supabase
      .from('reference_audio')
      .select(cols)
      .in('id', restorableIds);
    for (const r of (restored ?? []) as AudioRow[]) {
      if (!rows.some((existing) => existing.id === r.id)) rows.push(r);
    }
  }

  // Identify the silent clips: quick byte-rate prefilter, then verify each
  // candidate with ffmpeg volumedetect so we never re-mine an audible clip.
  const suspects = rows.filter(
    (r) => (r.size_bytes ?? 0) / (r.duration_ms || 1) < 6,
  );
  console.log(`  ${rows.length} clip(s), ${suspects.length} byte-rate suspect(s); verifying…`);
  const silent: AudioRow[] = [];
  for (const r of suspects) {
    if (!r.storage_path) continue;
    const { data: blob } = await supabase.storage
      .from(AUDIO_BUCKET)
      .download(r.storage_path);
    if (!blob) continue;
    const db = maxVolumeDb(Buffer.from(await blob.arrayBuffer()), opts.scratch);
    if (db < opts.maxSilentDb) silent.push(r);
  }
  console.log(`  ${silent.length} confirmed-silent clip(s) to re-cut`);
  if (silent.length === 0) return;

  const sourceUrl = silent.find((r) => r.source_url)?.source_url ?? null;
  if (!sourceUrl) {
    console.log('  no source_url on any silent row — cannot re-cut, skipping');
    return;
  }

  let localSource: string | undefined;
  if (opts.localSourceDir) {
    localSource = resolveLocalSource(opts.localSourceDir, sourceUrl);
    if (!localSource) {
      console.log(
        `  no local source file for ${youtubeVideoId(sourceUrl)} in ${opts.localSourceDir} — skipping`,
      );
      return;
    }
  }

  // Sentence text for each silent clip.
  const { data: sents } = await supabase
    .from('sentences')
    .select('id, japanese')
    .in('id', [...new Set(silent.map((r) => r.sentence_id))]);
  const textById = new Map((sents ?? []).map((s) => [String(s.id), String(s.japanese)]));

  const entries: JobEntry[] = silent
    .map((r) => ({
      row: r,
      japanese: textById.get(r.sentence_id) ?? '',
      startMs: r.source_start_ms ?? Number.NaN,
      endMs: r.source_end_ms ?? Number.NaN,
    }))
    .filter((j) => {
      if (!j.japanese) console.log(`  ! ${j.row.sentence_id}: no sentence text, skipping`);
      if (Number.isNaN(j.startMs) || Number.isNaN(j.endMs)) {
        console.log(`  ! ${j.row.sentence_id}: no source timing, skipping`);
      }
      return j.japanese && !Number.isNaN(j.startMs) && !Number.isNaN(j.endMs);
    });

  console.log(
    `\n  Plan: re-cut ${entries.length} clip(s) ` +
      `${localSource ? `from ${basename(localSource)}` : `via mining job from ${sourceUrl}`}`,
  );
  for (const j of entries) {
    console.log(`    ${String(j.startMs).padStart(7)}–${String(j.endMs).padStart(7)}ms  ${j.japanese}`);
  }

  if (!opts.apply) {
    console.log('  (dry run — pass --apply to re-cut and write)');
    return;
  }

  const cutter = localSource
    ? createLocalCutter(localSource, opts.scratch)
    : await createMiningCutter(sourceUrl);
  console.log(`  Cutting from ${cutter.label}`);

  let written = 0;
  try {
    for (const j of entries) {
      const { bytes, durationMs } = await cutter.cut(j);
      const db = maxVolumeDb(bytes, opts.scratch);
      if (db < opts.maxSilentDb) {
        console.log(`    ! still silent (${db}dB): ${j.japanese} — leaving old row`);
        continue;
      }

      const template = j.row;
      const audioId = `${REMINE_ID_PREFIX}${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const path = `${userId}/${bookId}/${audioId}.m4a`;
      const { error: upErr } = await supabase.storage
        .from(AUDIO_BUCKET)
        .upload(path, bytes, { contentType: 'audio/mp4', upsert: true });
      if (upErr) throw new Error(`upload ${path}: ${upErr.message}`);

      const { error: insErr } = await supabase.from('reference_audio').insert({
        id: audioId,
        owner_id: userId,
        book_id: bookId,
        sentence_id: template.sentence_id,
        source_id: template.source_id,
        source_sentence_id: `${template.source_id}:remine-${template.sentence_id}`,
        source_title: template.source_title,
        source_url: template.source_url,
        storage_path: path,
        mime_type: 'audio/mp4',
        duration_ms: durationMs,
        size_bytes: bytes.length,
        source_start_ms: j.startMs,
        source_end_ms: j.endMs,
      });
      if (insErr) throw new Error(`insert ${audioId}: ${insErr.message}`);

      const { error: delErr } = await supabase
        .from('reference_audio')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', template.id);
      if (delErr) throw new Error(`soft-delete ${template.id}: ${delErr.message}`);

      written += 1;
      console.log(`    + ${durationMs}ms  ${bytes.length}B  max=${db.toFixed(1)}dB  ${j.japanese}`);
    }
  } finally {
    await cutter.close?.();
  }
  console.log(`\n  Done: ${written}/${entries.length} clip(s) re-cut and replaced.`);
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const redo = argv.includes('--redo');
  const maxSilentDb = Number(arg(argv, '--max-silent-db') ?? -50);
  const bookIds = arg(argv, '--book') ? [arg(argv, '--book')!] : DEFAULT_BOOK_IDS;
  const localSourceDir = arg(argv, '--local-source');

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const scratch = mkdtempSync(join(tmpdir(), 'remine-'));

  try {
    for (const bookId of bookIds) {
      await remineBook(supabase, user.id, bookId, {
        apply,
        redo,
        maxSilentDb,
        scratch,
        localSourceDir,
      });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (!apply) console.log('\nDry run complete — re-run with --apply to write.');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
