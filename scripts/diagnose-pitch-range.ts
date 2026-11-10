/**
 * Read-only diagnostic: how wide is the native pitch movement in each book's
 * reference clips? Per clip it reports the voiced median (Hz), the 10th–90th
 * percentile range over the whole sentence, and the widest such range over any
 * 1.1 s window (phrase scale — what the live shadow chart shows). Frames pass
 * through the live octave guard first, so the ranges are a floor-ish estimate:
 * clips with background music or a second speaker can still inflate them.
 *
 * Audio is downloaded from storage per clip and discarded; nothing is written.
 * Needs `ffmpeg` on PATH.
 *
 * Usage: npx tsx scripts/diagnose-pitch-range.ts [--per-book N]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

import { createLivePitchGuard, extractPitch } from '../src/lib/pitch';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';
import { downloadReferenceClip } from './lib/referenceAudioStorage';

const SAMPLE_RATE = 16_000;
const TMP_DIR = '/tmp/pitch-range-diag';
const PHRASE_SECONDS = 1.1;

interface BookRow {
  id: string;
  title: string;
}

interface AudioRow {
  id: string;
  bookId: string;
  storagePath: string | null;
  durationMs: number;
}

function decode(bytes: Buffer): Promise<Float32Array> {
  mkdirSync(TMP_DIR, { recursive: true });
  const tmpPath = `${TMP_DIR}/clip-${process.pid}.bin`;
  writeFileSync(tmpPath, bytes);
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-v', 'error', '-y', '-i', tmpPath, '-f', 'f32le', '-ac', '1', '-ar', String(SAMPLE_RATE), 'pipe:1']);
    const chunks: Buffer[] = [];
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}`));
      const all = Buffer.concat(chunks);
      resolve(new Float32Array(all.buffer, all.byteOffset, Math.floor(all.length / 4)).slice());
    });
  });
}

const quantile = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
const median = (values: number[]): number => quantile(values.slice().sort((a, b) => a - b), 0.5);

function rangeSt(hzs: number[]): number {
  if (hzs.length < 8) return 0;
  const st = hzs.map((hz) => 12 * Math.log2(hz)).sort((a, b) => a - b);
  return quantile(st, 0.9) - quantile(st, 0.1);
}

const fmt = (values: number[]): string => {
  const sorted = values.slice().sort((a, b) => a - b);
  return `p25 ${quantile(sorted, 0.25).toFixed(1)}  median ${quantile(sorted, 0.5).toFixed(1)}  p75 ${quantile(sorted, 0.75).toFixed(1)}`;
};

async function main() {
  const perBookArg = process.argv.indexOf('--per-book');
  const perBook = perBookArg > 0 ? Number(process.argv[perBookArg + 1]) || 25 : 25;
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const books = await fetchAll<BookRow>(supabase, 'books', 'id, title', user.id, (r) => ({
    id: r.id as string,
    title: String(r.title ?? ''),
  }));
  const audio = await fetchAll<AudioRow>(supabase, 'reference_audio', 'id, book_id, storage_path, duration_ms', user.id, (r) => ({
    id: r.id as string,
    bookId: r.book_id as string,
    storagePath: (r.storage_path as string | null) ?? null,
    durationMs: Number(r.duration_ms ?? 0),
  }));
  for (const book of books) {
    const clips = audio.filter((a) => a.bookId === book.id && a.storagePath && a.durationMs >= 1500 && a.durationMs <= 12_000);
    if (clips.length === 0) continue;
    // Evenly spaced sample so the result isn't one episode.
    const step = Math.max(1, Math.floor(clips.length / perBook));
    const sample = clips.filter((_, index) => index % step === 0).slice(0, perBook);
    const medians: number[] = [];
    const sentenceRanges: number[] = [];
    const phraseRanges: number[] = [];
    for (const clip of sample) {
      try {
        const { data: blob, error } = await downloadReferenceClip(supabase, clip.storagePath!);
        if (error || !blob) continue;
        const samples = await decode(Buffer.from(await blob.arrayBuffer()));
        const track = extractPitch({ sampleRate: SAMPLE_RATE, samples, durationSeconds: samples.length / SAMPLE_RATE });
        const guard = createLivePitchGuard();
        const voiced = track.frames
          .filter((f) => f.voiced && f.hz !== null)
          .map((f) => ({ timeSeconds: f.timeSeconds, hz: guard(f.hz as number) }))
          .filter((f): f is { timeSeconds: number; hz: number } => f.hz !== null);
        if (voiced.length < 20) continue;
        medians.push(median(voiced.map((f) => f.hz)));
        sentenceRanges.push(rangeSt(voiced.map((f) => f.hz)));
        let widest = 0;
        for (let start = 0; start + PHRASE_SECONDS <= track.durationSeconds; start += 0.25) {
          const inWindow = voiced.filter((f) => f.timeSeconds >= start && f.timeSeconds < start + PHRASE_SECONDS);
          widest = Math.max(widest, rangeSt(inWindow.map((f) => f.hz)));
        }
        phraseRanges.push(widest);
      } catch (error) {
        console.error(`  skip ${clip.id}: ${(error as Error).message}`);
      }
    }
    if (medians.length === 0) {
      console.log(`${book.title.slice(0, 50)}: no usable clips (${clips.length} candidates)`);
      continue;
    }
    console.log(`${book.title.slice(0, 50)}  (n=${medians.length})`);
    console.log(`  voice median Hz:        ${fmt(medians)}`);
    console.log(`  sentence range (st):    ${fmt(sentenceRanges)}`);
    console.log(`  widest 1.1s range (st): ${fmt(phraseRanges)}`);
  }
}

void main();
