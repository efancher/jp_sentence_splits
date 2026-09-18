/**
 * Backfill for word-clip boundary precision (docs/STATUS.md 2026-09-18
 * "word-clip boundary round-trip ASR verification experiment"): for each
 * confirmed `sentence_vocabulary` occurrence, tries the aligner's raw
 * (unpadded) match ("tight") against the runtime default
 * (`isolatedWordRange`'s fixed -60/+120ms pad, "default") and writes
 * `audio_start_ms`/`audio_end_ms` — the same override field the
 * `SegmentLoopPlayer` "Adjust" hand-correction editor uses — whenever
 * `tight` clearly transcribes back to the word better than `default` does.
 *
 * Never touches a link that already has a manual `audio_start_ms`/
 * `audio_end_ms` (a human already looked at that one). Never writes a
 * `default` decision either — `default` is already what `isolatedWordRange`
 * produces at runtime with no override stored, so "default wins" means
 * "leave it alone," not "write default explicitly."
 *
 * Two-phase, cross-process (see the two experiment findings this is built
 * on): this script fetches data, computes both candidate ranges, and
 * ffmpeg-trims both clips per word into a temp dir; a Python subprocess
 * (`scripts/score-word-audio-candidates.py`, the `mfa` conda env — same
 * host as `shadowing-analysis-api`, not this repo's own venv) loads
 * `large-v3-turbo` once and re-transcribes every clip, since it scored
 * ~50% higher (relative) than the diagnostic "base" model on the same
 * clips in testing — a real trustworthiness difference for a decision
 * that writes data, not just a hedge-worded diagnostic. This script then
 * applies only the `tight` decisions.
 *
 * Usage:
 *   npm run backfill:word-audio-range -- [--apply] [--book <bookId>]
 *     [--limit N]
 *
 * Dry-run by default. Needs ffmpeg on PATH, the `mfa` conda env's Python
 * (faster-whisper + fugashi/unidic-lite/jaconv — see
 * score-word-audio-candidates.py's docstring), and, for occurrences whose
 * sentence has no cached alignment yet, shadowing-analysis-api (`/align`)
 * reachable. Run this on the box that hosts both (codex-dev).
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALIGNMENT_VERSION } from '../src/lib/analysisApi';
import type { AlignmentResult, WordAlignment } from '../src/domain/types';
import { isolatedWordRange, isolatedWordRangeUnpadded } from '../src/lib/isolatedWordRange';

import { alignAudio, ffmpegTrimToM4a, ffprobeDurationMs } from './lib/audioClipHelpers';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const AUDIO_BUCKET = 'reference-audio';
const DEFAULT_LIMIT = 50;
const MFA_PYTHON = process.env.MFA_PYTHON ?? '/home/ed/miniforge3/envs/mfa/bin/python3.14';
const SCORER_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'score-word-audio-candidates.py');

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
  hasManualRange: boolean;
}

interface Decision {
  id: string;
  surfaceForm: string;
  decision: 'tight' | 'no-change';
  defaultSimilarity: number;
  tightSimilarity: number;
  tightStartMs: number;
  tightEndMs: number;
}

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(`--${name}`);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function runScorer(clipsDir: string): Promise<Decision[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(MFA_PYTHON, [SCORER_SCRIPT, clipsDir], { stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`score-word-audio-candidates.py exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim().split('\n').pop() ?? '[]'));
      } catch (err) {
        reject(new Error(`Couldn't parse scorer output: ${(err as Error).message}\n${stdout.slice(-500)}`));
      }
    });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const bookFilter = parseArg(argv, 'book');
  const limit = Number(parseArg(argv, 'limit') ?? DEFAULT_LIMIT);

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const workDir = await mkdtemp(join(tmpdir(), 'word-audio-range-backfill-'));

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
        'id, sentence_id, surface_form, audio_start_ms, audio_end_ms',
        user.id,
        (row) => ({
          id: String(row.id),
          sentenceId: String(row.sentence_id),
          surfaceForm: String(row.surface_form ?? ''),
          hasManualRange: row.audio_start_ms != null && row.audio_end_ms != null,
        }),
      ),
    ]);
    if (alignmentResult.error) {
      throw new Error(`Failed to fetch reference_alignment: ${alignmentResult.error.message}`);
    }
    // Only trust a cached alignment when it's current — a stale one (from
    // before an aligner-side fix, e.g. ALIGNMENT_VERSION 1 -> 2's numeral
    // expansion) would silently reproduce the bug this backfill exists to
    // fix instead of triggering a fresh /align call.
    const alignmentByAudioId = new Map(
      (alignmentResult.data ?? [])
        .filter((row) => Number(row.alignment_version) === ALIGNMENT_VERSION)
        .map((row) => [String(row.id), row.alignment as AlignmentResult]),
    );

    const japaneseBySentence = new Map(sentences.map((s) => [s.id, s.japanese]));
    const audioBySentence = new Map<string, AudioRow>();
    for (const row of audioRows) {
      if (!audioBySentence.has(row.sentenceId)) audioBySentence.set(row.sentenceId, row);
    }

    let candidates = vocabRows.filter(
      (v) => v.surfaceForm && !v.hasManualRange && audioBySentence.get(v.sentenceId)?.storagePath,
    );
    if (bookFilter) {
      candidates = candidates.filter((v) => audioBySentence.get(v.sentenceId)?.bookId === bookFilter);
    }
    candidates = candidates.slice(0, limit);

    if (bookFilter) console.log(`Scoped to book ${bookFilter}.`);
    console.log(`Preparing clips for ${candidates.length} word occurrence(s) (skipping links with an existing manual range)...\n`);

    const sentenceAudioCache = new Map<string, { audioPath: string; durationMs: number; words: WordAlignment[] } | null>();

    async function getSentenceAudio(sentenceId: string) {
      if (sentenceAudioCache.has(sentenceId)) return sentenceAudioCache.get(sentenceId)!;
      const audio = audioBySentence.get(sentenceId);
      const japanese = japaneseBySentence.get(sentenceId);
      if (!audio?.storagePath || !japanese) {
        sentenceAudioCache.set(sentenceId, null);
        return null;
      }
      const { data: blob, error } = await supabase.storage.from(AUDIO_BUCKET).download(audio.storagePath);
      if (error || !blob) {
        console.log(`  [skip sentence ${sentenceId}] couldn't download audio (${error?.message})`);
        sentenceAudioCache.set(sentenceId, null);
        return null;
      }
      const audioPath = join(workDir, `${sentenceId}.m4a`);
      await writeFile(audioPath, Buffer.from(await blob.arrayBuffer()));

      let alignment = alignmentByAudioId.get(audio.id) ?? null;
      if (!alignment) {
        try {
          alignment = await alignAudio(blob, japanese);
        } catch (err) {
          console.log(`  [skip sentence ${sentenceId}] alignment unavailable (${(err as Error).message})`);
          sentenceAudioCache.set(sentenceId, null);
          return null;
        }
      }
      const durationMs = await ffprobeDurationMs(audioPath);
      const ctx = { audioPath, durationMs, words: alignment.words };
      sentenceAudioCache.set(sentenceId, ctx);
      return ctx;
    }

    let prepared = 0;
    let skipped = 0;
    for (const [i, vocab] of candidates.entries()) {
      process.stdout.write(`[${i + 1}/${candidates.length}] ${vocab.surfaceForm} … `);
      const ctx = await getSentenceAudio(vocab.sentenceId);
      if (!ctx) {
        console.log('skip (no context)');
        skipped += 1;
        continue;
      }
      const japanese = japaneseBySentence.get(vocab.sentenceId)!;
      const raw = isolatedWordRangeUnpadded(ctx.words, japanese, vocab.surfaceForm);
      const defaultRange = isolatedWordRange(ctx.words, japanese, vocab.surfaceForm);
      if (!raw || !defaultRange) {
        console.log('skip (no aligner match)');
        skipped += 1;
        continue;
      }
      const clamp = (r: { startMs: number; endMs: number }) => ({
        startMs: Math.max(0, r.startMs),
        endMs: Math.min(ctx.durationMs, r.endMs),
      });
      const tightRange = clamp(raw);
      const clampedDefault = clamp(defaultRange);
      if (tightRange.endMs - tightRange.startMs < 80 || clampedDefault.endMs - clampedDefault.startMs < 80) {
        console.log('skip (degenerate range)');
        skipped += 1;
        continue;
      }

      for (const [label, range] of [
        ['default', clampedDefault],
        ['tight', tightRange],
      ] as const) {
        const clipFile = `clip-${i}-${label}.m4a`;
        await ffmpegTrimToM4a(ctx.audioPath, join(workDir, clipFile), range.startMs, range.endMs);
        await appendFile(
          join(workDir, 'manifest.jsonl'),
          `${JSON.stringify({
            id: vocab.id,
            surfaceForm: vocab.surfaceForm,
            label,
            clipFile,
            startMs: range.startMs,
            endMs: range.endMs,
          })}\n`,
        );
      }
      prepared += 1;
      console.log('ok');
    }

    console.log(`\n${prepared} word(s) prepared, ${skipped} skipped. Scoring with large-v3-turbo (this loads the model once, then reuses it for every clip)...\n`);
    if (prepared === 0) {
      console.log('Nothing to score.');
      return;
    }

    const decisions = await runScorer(workDir);
    const toChange = decisions.filter((d) => d.decision === 'tight');
    const noChange = decisions.filter((d) => d.decision === 'no-change');

    console.log(`\n${toChange.length} link(s) would switch to the tight boundary, ${noChange.length} keep the default.\n`);
    for (const d of toChange) {
      console.log(
        `  ${d.surfaceForm}  default=${d.defaultSimilarity.toFixed(2)} tight=${d.tightSimilarity.toFixed(2)}  ` +
          `-> [${Math.round(d.tightStartMs)}, ${Math.round(d.tightEndMs)}]ms`,
      );
      if (apply) {
        const { error } = await supabase
          .from('sentence_vocabulary')
          .update({ audio_start_ms: Math.round(d.tightStartMs), audio_end_ms: Math.round(d.tightEndMs) })
          .eq('id', d.id);
        if (error) throw new Error(`Failed to update sentence_vocabulary ${d.id}: ${error.message}`);
      }
    }

    console.log(`\nDone. ${toChange.length} link(s) ${apply ? 'updated' : 'would be updated'}.`);
    if (!apply) {
      console.log('Dry run — nothing written. Re-run with --apply to write.');
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
