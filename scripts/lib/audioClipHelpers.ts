/**
 * Shared ffmpeg/alignment helpers for scripts that need to re-derive a
 * word-clip boundary from a sentence's reference audio — used by both
 * `experiment-word-boundary-verification.ts` and
 * `backfill-word-audio-range.ts` so the two don't drift.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { AlignmentResult } from '../../src/domain/types';

const execFileAsync = promisify(execFile);

const ALIGN_API_BASE = (
  process.env.ANALYSIS_ALIGN_API_BASE ??
  process.env.ALIGN_API_BASE ??
  'http://127.0.0.1:8002'
).replace(/\/$/, '');

export async function alignAudio(blob: Blob, transcript: string): Promise<AlignmentResult> {
  const form = new FormData();
  form.append('audio', blob, 'clip');
  form.append('transcript', transcript);
  const resp = await fetch(`${ALIGN_API_BASE}/align`, { method: 'POST', body: form });
  if (!resp.ok) {
    throw new Error(`/align ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = (await resp.json()) as AlignmentResult;
  if (!Array.isArray(data.words)) throw new Error('/align returned no words[]');
  return data;
}

export async function ffprobeDurationMs(path: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    path,
  ]);
  const payload = JSON.parse(stdout);
  return Math.max(1, Math.round(parseFloat(payload.format.duration) * 1000));
}

export async function ffmpegTrimToM4a(
  sourcePath: string,
  outPath: string,
  startMs: number,
  endMs: number,
): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-ss',
    (startMs / 1000).toFixed(3),
    '-i',
    sourcePath,
    '-t',
    ((endMs - startMs) / 1000).toFixed(3),
    '-vn',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    outPath,
  ]);
}
