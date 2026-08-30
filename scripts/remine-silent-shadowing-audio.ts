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
 * Fix: re-mine each affected book's source video through the youtube-mining
 * `/jobs` API (fresh yt-dlp download + ffmpeg cut), re-cutting each broken
 * sentence from the real source audio at its stored
 * source_start_ms/source_end_ms. Writes NEW reference_audio rows (new ids +
 * storage paths) and soft-deletes the silent ones — an in-place update
 * would not reach devices that already cached the silent blob (sync keeps
 * the existing local blob on a reference_audio update, see
 * src/sync/engine.ts).
 *
 * Dry-run by default; --apply to write. Idempotent: a sentence that already
 * has a verified-audible non-deleted clip is skipped. --redo clears this
 * script's prior output (audio_remine_* rows) for the book first.
 *
 * Needs the mining service reachable (tailnet) and ffmpeg on PATH (silence
 * verification). Override the mining URL with MINING_API_BASE.
 *
 * Usage:
 *   npx tsx scripts/remine-silent-shadowing-audio.ts [--apply] [--redo] \
 *     [--book <id>] [--max-silent-db -50]
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

async function remineBook(
  supabase: Supabase,
  userId: string,
  bookId: string,
  opts: { apply: boolean; redo: boolean; maxSilentDb: number; scratch: string },
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

  if (opts.redo) {
    const { data: prior } = await supabase
      .from('reference_audio')
      .select('id, storage_path, sentence_id')
      .eq('book_id', bookId)
      .like('id', `${REMINE_ID_PREFIX}%`);
    // Originals a prior run soft-deleted when it wrote those remine rows —
    // restore them so the silence detector can find and re-mine them again.
    const { data: orphaned } = await supabase
      .from('reference_audio')
      .select('id')
      .eq('book_id', bookId)
      .not('deleted_at', 'is', null)
      .not('id', 'like', `${REMINE_ID_PREFIX}%`)
      .in('sentence_id', [...new Set((prior ?? []).map((r) => r.sentence_id))]);
    console.log(
      `  --redo: clearing ${prior?.length ?? 0} prior remine row(s), ` +
        `restoring ${orphaned?.length ?? 0} soft-deleted original(s)`,
    );
    if (opts.apply && prior?.length) {
      const paths = prior.map((r) => r.storage_path).filter(Boolean) as string[];
      if (paths.length) await supabase.storage.from(AUDIO_BUCKET).remove(paths);
      const { error } = await supabase
        .from('reference_audio')
        .delete()
        .in('id', prior.map((r) => r.id));
      if (error) throw new Error(`--redo delete: ${error.message}`);
      if (orphaned?.length) {
        const { error: restoreErr } = await supabase
          .from('reference_audio')
          .update({ deleted_at: null })
          .in('id', orphaned.map((r) => r.id));
        if (restoreErr) throw new Error(`--redo restore: ${restoreErr.message}`);
      }
    }
  }

  const { data: rowsData, error: rowsErr } = await supabase
    .from('reference_audio')
    .select(
      'id, sentence_id, book_id, source_id, source_sentence_id, source_title, source_url, storage_path, mime_type, duration_ms, size_bytes, source_start_ms, source_end_ms',
    )
    .eq('book_id', bookId)
    .eq('owner_id', userId)
    .is('deleted_at', null)
    .not('id', 'like', `${REMINE_ID_PREFIX}%`);
  if (rowsErr) throw new Error(`fetch reference_audio: ${rowsErr.message}`);
  const rows = (rowsData ?? []) as AudioRow[];

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
  console.log(`  ${silent.length} confirmed-silent clip(s) to re-mine`);
  if (silent.length === 0) return;

  const sourceUrl = silent.find((r) => r.source_url)?.source_url;
  if (!sourceUrl) {
    console.log('  no source_url on any silent row — cannot re-mine, skipping');
    return;
  }

  // Sentence text for each silent clip.
  const { data: sents } = await supabase
    .from('sentences')
    .select('id, japanese')
    .in('id', [...new Set(silent.map((r) => r.sentence_id))]);
  const textById = new Map((sents ?? []).map((s) => [String(s.id), String(s.japanese)]));

  const jobs = silent
    .map((r) => ({
      row: r,
      japanese: textById.get(r.sentence_id) ?? '',
      startMs: r.source_start_ms,
      endMs: r.source_end_ms,
    }))
    .filter((j) => {
      if (!j.japanese) console.log(`  ! ${j.row.sentence_id}: no sentence text, skipping`);
      if (j.startMs == null || j.endMs == null) {
        console.log(`  ! ${j.row.sentence_id}: no source timing, skipping`);
      }
      return j.japanese && j.startMs != null && j.endMs != null;
    });

  console.log(`\n  Plan: re-mine ${jobs.length} clip(s) from ${sourceUrl}`);
  for (const j of jobs) {
    console.log(`    ${String(j.startMs).padStart(7)}–${String(j.endMs).padStart(7)}ms  ${j.japanese}`);
  }

  if (!opts.apply) {
    console.log('  (dry run — pass --apply to re-mine and write)');
    return;
  }

  // 1. Create the mining job, wait for the source download + subtitle parse.
  console.log('\n  Creating mining job…');
  const { jobId } = await postJson<{ jobId: string }>('/jobs', { url: sourceUrl });
  let written = 0;
  try {
    await waitForJob(jobId);

    // 2. Re-cut each sentence from the fresh source at its stored timing.
    for (const j of jobs) {
      const clip = await postJson<ClipResponse>(`/jobs/${jobId}/clip`, {
        japanese: j.japanese,
        startMs: j.startMs,
        endMs: j.endMs,
        generateKana: false,
      });
      const audioResp = await fetch(
        `${API_BASE}/jobs/${jobId}/clips/${clip.sentenceId}/audio`,
      );
      if (!audioResp.ok) throw new Error(`fetch clip audio -> ${audioResp.status}`);
      const bytes = Buffer.from(await audioResp.arrayBuffer());
      const db = maxVolumeDb(bytes, opts.scratch);
      if (db < opts.maxSilentDb) {
        console.log(`    ! still silent (${db}dB) after re-mine: ${j.japanese} — leaving old row`);
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
        duration_ms: clip.audio.durationMs,
        size_bytes: bytes.length,
        source_start_ms: j.startMs,
        source_end_ms: j.endMs,
      });
      if (insErr) throw new Error(`insert ${audioId}: ${insErr.message}`);

      // 3. Soft-delete the silent row it replaces.
      const { error: delErr } = await supabase
        .from('reference_audio')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', template.id);
      if (delErr) throw new Error(`soft-delete ${template.id}: ${delErr.message}`);

      written += 1;
      console.log(`    + ${clip.audio.durationMs}ms  ${bytes.length}B  max=${db}dB  ${j.japanese}`);
    }
  } finally {
    await fetch(`${API_BASE}/jobs/${jobId}`, { method: 'DELETE' }).catch(() => {});
  }
  console.log(`\n  Done: ${written}/${jobs.length} clip(s) re-mined and replaced.`);
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const redo = argv.includes('--redo');
  const maxSilentDb = Number(arg(argv, '--max-silent-db') ?? -50);
  const bookIds = arg(argv, '--book') ? [arg(argv, '--book')!] : DEFAULT_BOOK_IDS;

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const scratch = mkdtempSync(join(tmpdir(), 'remine-'));

  try {
    for (const bookId of bookIds) {
      await remineBook(supabase, user.id, bookId, { apply, redo, maxSilentDb, scratch });
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
