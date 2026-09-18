/**
 * First experiment for improving word-clip precision (see chat 2026-09-18):
 * does re-verifying a candidate word-clip boundary against a fresh ASR pass
 * (`POST /validate-transcript`) help pick a better boundary than the fixed
 * -60/+120ms pad `isolatedWordRange` always applies
 * (`src/lib/isolatedWordRange.ts`)?
 *
 * For each confirmed `sentence_vocabulary` occurrence with reference audio
 * and a forced alignment, this builds a few candidate word-clip boundaries
 * off the aligner's raw (unpadded) match — the current default pad, no pad,
 * double pad, and (when local silence detection finds a nearby pause) a
 * silence-snapped variant — ffmpeg-trims each one out of the sentence's own
 * audio, and scores it by re-transcribing the trimmed clip and comparing it
 * (hiragana-normalized, server-side) to the word's surface form. Reports
 * which candidate wins most often, and by how much, over the sample.
 *
 * Purely a read-only signal for a design decision, not a fixer: nothing is
 * written back, and a short isolated-word clip is a much harder case for
 * "base" Whisper than the whole-sentence clips `validate-sentence-
 * transcripts.ts` checks, so a low hit rate here is itself a finding (round-
 * trip verification may not be viable at word length with the current
 * model), not necessarily a boundary problem.
 *
 * Usage:
 *   npm run experiment:word-boundary-verification -- [--book <bookId>]
 *     [--limit N]
 *
 * Set KEEP_CLIPS_DIR=<dir> to retain every candidate clip plus a
 * `manifest.jsonl` (sentenceId, surfaceForm, candidate label, clip path,
 * this run's asrText/similarity) instead of deleting them — lets a
 * separate script re-transcribe the exact same clips with a different ASR
 * model for a same-boundaries, different-model comparison.
 *
 * Needs ffmpeg on PATH, plus youtube-mining-api (`/validate-transcript`)
 * and, for occurrences whose sentence has no cached alignment yet,
 * shadowing-analysis-api (`/align`) reachable. Run this on the box that
 * hosts both (codex-dev) for a local, no-tailnet-hop run; override the
 * aligner URL with ANALYSIS_ALIGN_API_BASE if needed.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, readFile, writeFile, appendFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { YOUTUBE_MINING_API_BASE } from '../src/appConfig';
import { ALIGNMENT_VERSION } from '../src/lib/analysisApi';
import type { AlignmentResult, WordAlignment } from '../src/domain/types';
import { isolatedWordRangeUnpadded } from '../src/lib/isolatedWordRange';
import { detectSilences, type SilenceSpan } from '../src/lib/waveform';

import { alignAudio, ffmpegTrimToM4a, ffprobeDurationMs } from './lib/audioClipHelpers';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const execFileAsync = promisify(execFile);

const AUDIO_BUCKET = 'reference-audio';
const DEFAULT_LIMIT = 20;
const DECODE_SAMPLE_RATE = 16000;
const SILENCE_SEARCH_WINDOW_MS = 200;
const MIN_CLIP_MS = 80;

interface SentenceRow {
  id: string;
  japanese: string;
}

interface AudioRow {
  id: string;
  sentenceId: string;
  bookId: string | null;
  storagePath: string | null;
  mimeType: string;
}

interface VocabRow {
  id: string;
  sentenceId: string;
  surfaceForm: string;
}

interface Candidate {
  label: string;
  range: { startMs: number; endMs: number };
}

interface SentenceContext {
  audioPath: string;
  durationMs: number;
  words: WordAlignment[];
  silenceSpans: SilenceSpan[] | null;
}

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(`--${name}`);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

async function validateTranscript(
  audioBase64: string,
  mimeType: string,
  expectedText: string,
): Promise<{ asrText: string | null; similarity: number | null; reason: string | null }> {
  const response = await fetch(`${YOUTUBE_MINING_API_BASE}/validate-transcript`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBase64, mimeType, expectedText }),
  });
  if (!response.ok) {
    throw new Error(`validate-transcript failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

async function decodeMonoPcm(path: string): Promise<Float32Array | null> {
  const rawPath = `${path}.raw`;
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      path,
      '-f',
      'f32le',
      '-ac',
      '1',
      '-ar',
      String(DECODE_SAMPLE_RATE),
      rawPath,
    ]);
    const buf = await readFile(rawPath);
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  } catch (err) {
    console.log(`    [silence-detect skipped] ${(err as Error).message.slice(0, 120)}`);
    return null;
  } finally {
    await rm(rawPath, { force: true });
  }
}

function nearestSilenceMidMs(
  spans: SilenceSpan[],
  targetMs: number,
  windowMs: number,
): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const span of spans) {
    const midMs = span.midSeconds * 1000;
    const dist = Math.abs(midMs - targetMs);
    if (dist <= windowMs && dist < bestDist) {
      bestDist = dist;
      best = midMs;
    }
  }
  return best;
}

function buildCandidates(
  raw: { startMs: number; endMs: number },
  ctx: SentenceContext,
): Candidate[] {
  const clamp = (r: { startMs: number; endMs: number }) => ({
    startMs: Math.max(0, r.startMs),
    endMs: Math.min(ctx.durationMs, r.endMs),
  });
  const candidates: Candidate[] = [
    { label: 'default(-60/+120)', range: clamp({ startMs: raw.startMs - 60, endMs: raw.endMs + 120 }) },
    { label: 'tight(0/0)', range: clamp({ startMs: raw.startMs, endMs: raw.endMs }) },
    { label: 'loose(-120/+240)', range: clamp({ startMs: raw.startMs - 120, endMs: raw.endMs + 240 }) },
  ];
  if (ctx.silenceSpans && ctx.silenceSpans.length > 0) {
    const snapStart =
      nearestSilenceMidMs(ctx.silenceSpans, raw.startMs, SILENCE_SEARCH_WINDOW_MS) ?? raw.startMs - 60;
    const snapEnd =
      nearestSilenceMidMs(ctx.silenceSpans, raw.endMs, SILENCE_SEARCH_WINDOW_MS) ?? raw.endMs + 120;
    candidates.push({ label: 'silence-snap', range: clamp({ startMs: snapStart, endMs: snapEnd }) });
  }
  return candidates.filter((c) => c.range.endMs - c.range.startMs >= MIN_CLIP_MS);
}

async function main() {
  const argv = process.argv.slice(2);
  const bookFilter = parseArg(argv, 'book');
  const limit = Number(parseArg(argv, 'limit') ?? DEFAULT_LIMIT);

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const workDir = await mkdtemp(join(tmpdir(), 'word-boundary-experiment-'));
  const keepClipsDir = process.env.KEEP_CLIPS_DIR;
  if (keepClipsDir) await mkdir(keepClipsDir, { recursive: true });

  try {
    console.log('Fetching sentences, reference audio, alignments, and vocabulary...');
    const [sentences, audioRows, alignmentResult, vocabRows] = await Promise.all([
      fetchAll<SentenceRow>(supabase, 'sentences', 'id, japanese', user.id, (row) => ({
        id: String(row.id),
        japanese: String(row.japanese ?? ''),
      })),
      fetchAll<AudioRow>(
        supabase,
        'reference_audio',
        'id, sentence_id, book_id, storage_path, mime_type',
        user.id,
        (row) => ({
          id: String(row.id),
          sentenceId: String(row.sentence_id),
          bookId: row.book_id ? String(row.book_id) : null,
          storagePath: row.storage_path ? String(row.storage_path) : null,
          mimeType: String(row.mime_type ?? 'audio/mp4'),
        }),
        'sentence_id',
      ),
      // reference_alignment has no deleted_at/soft-delete column (local-
      // recomputable cache, not a synced table) — fetchAll's filter doesn't
      // apply; query it directly like backfill-reference-alignment.ts does.
      supabase
        .from('reference_alignment')
        .select('id, alignment, alignment_version')
        .eq('owner_id', user.id),
      fetchAll<VocabRow>(
        supabase,
        'sentence_vocabulary',
        'id, sentence_id, surface_form',
        user.id,
        (row) => ({
          id: String(row.id),
          sentenceId: String(row.sentence_id),
          surfaceForm: String(row.surface_form ?? ''),
        }),
      ),
    ]);
    if (alignmentResult.error) {
      throw new Error(`Failed to fetch reference_alignment: ${alignmentResult.error.message}`);
    }
    // Only trust a cached alignment when it's current — see
    // backfill-word-audio-range.ts's identical guard for why.
    const alignmentRows = (alignmentResult.data ?? [])
      .filter((row) => Number(row.alignment_version) === ALIGNMENT_VERSION)
      .map((row) => ({
        id: String(row.id),
        alignment: row.alignment as AlignmentResult,
      }));

    const japaneseBySentence = new Map(sentences.map((s) => [s.id, s.japanese]));
    const audioBySentence = new Map<string, AudioRow>();
    for (const row of audioRows) {
      if (!audioBySentence.has(row.sentenceId)) audioBySentence.set(row.sentenceId, row);
    }
    const alignmentByAudioId = new Map(alignmentRows.map((r) => [r.id, r.alignment]));

    let candidates = vocabRows.filter((v) => v.surfaceForm && audioBySentence.get(v.sentenceId)?.storagePath);
    if (bookFilter) {
      candidates = candidates.filter((v) => audioBySentence.get(v.sentenceId)?.bookId === bookFilter);
    }
    candidates = candidates.slice(0, limit);

    if (bookFilter) console.log(`Scoped to book ${bookFilter}.`);
    console.log(`Testing ${candidates.length} word occurrence(s).\n`);

    const sentenceContextCache = new Map<string, SentenceContext | null>();

    async function getSentenceContext(sentenceId: string): Promise<SentenceContext | null> {
      if (sentenceContextCache.has(sentenceId)) return sentenceContextCache.get(sentenceId)!;
      const audio = audioBySentence.get(sentenceId);
      const japanese = japaneseBySentence.get(sentenceId);
      if (!audio?.storagePath || !japanese) {
        sentenceContextCache.set(sentenceId, null);
        return null;
      }
      const { data: blob, error } = await supabase.storage.from(AUDIO_BUCKET).download(audio.storagePath);
      if (error || !blob) {
        console.log(`  [skip sentence ${sentenceId}] couldn't download audio (${error?.message})`);
        sentenceContextCache.set(sentenceId, null);
        return null;
      }
      const audioPath = join(workDir, `${sentenceId}.m4a`);
      await writeFile(audioPath, Buffer.from(await blob.arrayBuffer()));

      let words = alignmentByAudioId.get(audio.id)?.words ?? null;
      if (!words) {
        try {
          const result = await alignAudio(blob, japanese);
          words = result.words;
        } catch (err) {
          console.log(`  [skip sentence ${sentenceId}] alignment unavailable (${(err as Error).message})`);
          sentenceContextCache.set(sentenceId, null);
          return null;
        }
      }

      const durationMs = await ffprobeDurationMs(audioPath);
      const samples = await decodeMonoPcm(audioPath);
      const silenceSpans = samples ? detectSilences(samples, DECODE_SAMPLE_RATE) : null;

      const ctx: SentenceContext = { audioPath, durationMs, words, silenceSpans };
      sentenceContextCache.set(sentenceId, ctx);
      return ctx;
    }

    const winCounts = new Map<string, number>();
    const similaritySums = new Map<string, { total: number; count: number }>();
    let skipped = 0;
    let tested = 0;

    for (const [i, vocab] of candidates.entries()) {
      process.stdout.write(`[${i + 1}/${candidates.length}] ${vocab.surfaceForm} … `);
      const ctx = await getSentenceContext(vocab.sentenceId);
      if (!ctx) {
        console.log('skip (no context)');
        skipped += 1;
        continue;
      }
      const japanese = japaneseBySentence.get(vocab.sentenceId)!;
      const raw = isolatedWordRangeUnpadded(ctx.words, japanese, vocab.surfaceForm);
      if (!raw) {
        console.log('skip (no aligner match)');
        skipped += 1;
        continue;
      }

      const wordCandidates = buildCandidates(raw, ctx);
      const scored: { label: string; similarity: number | null; asrText: string | null }[] = [];
      for (const candidate of wordCandidates) {
        const outPath = join(workDir, `clip-${i}-${candidate.label.replace(/[^a-z0-9]/gi, '')}.m4a`);
        try {
          await ffmpegTrimToM4a(ctx.audioPath, outPath, candidate.range.startMs, candidate.range.endMs);
          const clipBytes = await readFile(outPath);
          const result = await validateTranscript(
            clipBytes.toString('base64'),
            'audio/mp4',
            vocab.surfaceForm,
          );
          scored.push({ label: candidate.label, similarity: result.similarity, asrText: result.asrText });
          if (keepClipsDir) {
            const keptName = `clip-${i}-${candidate.label.replace(/[^a-z0-9]/gi, '')}.m4a`;
            await copyFile(outPath, join(keepClipsDir, keptName));
            await appendFile(
              join(keepClipsDir, 'manifest.jsonl'),
              `${JSON.stringify({
                sentenceId: vocab.sentenceId,
                surfaceForm: vocab.surfaceForm,
                candidateLabel: candidate.label,
                clipFile: keptName,
                baseAsrText: result.asrText,
                baseSimilarity: result.similarity,
              })}\n`,
            );
          }
        } catch {
          scored.push({ label: candidate.label, similarity: null, asrText: null });
        } finally {
          await rm(outPath, { force: true });
        }
      }

      const withScore = scored.filter((s): s is typeof s & { similarity: number } => s.similarity !== null);
      if (withScore.length === 0) {
        console.log('unavailable (ASR returned nothing for any candidate)');
        skipped += 1;
        continue;
      }
      tested += 1;
      const best = withScore.reduce((a, b) => (b.similarity > a.similarity ? b : a));
      winCounts.set(best.label, (winCounts.get(best.label) ?? 0) + 1);
      for (const s of withScore) {
        const agg = similaritySums.get(s.label) ?? { total: 0, count: 0 };
        agg.total += s.similarity;
        agg.count += 1;
        similaritySums.set(s.label, agg);
      }
      console.log(
        `best=${best.label} (${best.similarity.toFixed(2)}) heard="${best.asrText}" [${scored
          .map((s) => `${s.label}=${s.similarity === null ? 'n/a' : s.similarity.toFixed(2)}`)
          .join(', ')}]`,
      );
    }

    console.log(`\nDone. ${tested} scored, ${skipped} skipped (of ${candidates.length}).\n`);
    if (tested > 0) {
      console.log('Win rate by candidate (best similarity among available candidates for that word):');
      for (const [label, count] of [...winCounts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${label}: ${count}/${tested} (${((count / tested) * 100).toFixed(0)}%)`);
      }
      console.log('\nMean similarity by candidate (over words where that candidate produced a score):');
      for (const [label, agg] of similaritySums.entries()) {
        console.log(`  ${label}: ${(agg.total / agg.count).toFixed(3)} (n=${agg.count})`);
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
