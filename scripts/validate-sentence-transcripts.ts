/**
 * First pass at automated transcript validation (docs/STATUS.md
 * 2026-09-11 "Mis-transcribed sentence + mis-cut reference audio"): for
 * each sentence with a reference-audio clip, re-transcribes the clip via
 * the youtube-mining service's `POST /validate-transcript` (a fresh Whisper
 * pass compared, on hiragana readings, against the sentence's stored
 * `japanese`) and flags anything below a similarity threshold.
 *
 * Read-only by design — this is a review-queue report, not a fixer.
 * Whisper errs too, especially on short/noisy clips, so a flagged sentence
 * needs a human listen, not an auto-correct. sent_263ac750's bug (a spurious
 * leading "ま、" that was never spoken, audio cut boundaries landing
 * mid-word) is exactly the failure mode this catches; that fix was done by
 * hand in the same session this script was built.
 *
 * Usage:
 *   npm run validate:sentence-transcripts -- [--book <bookId>]
 *     [--batch <importBatchId>] [--sentence <sentenceId>] [--limit N]
 *     [--threshold 0.6]
 *
 * Default scope is every sentence with a non-deleted reference_audio row,
 * capped at --limit (default 50) since each check is a real ASR call —
 * scope down with --book/--batch/--sentence for a targeted run, or raise
 * --limit for a full sweep (expect a slow run: one Whisper pass per
 * sentence).
 */
import { YOUTUBE_MINING_API_BASE } from '../src/appConfig';

import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const AUDIO_BUCKET = 'reference-audio';
const DEFAULT_LIMIT = 50;
const DEFAULT_THRESHOLD = 0.6;

interface SentenceRow {
  id: string;
  japanese: string;
  importBatchIds: string[];
}

interface AudioRow {
  sentenceId: string;
  bookId: string | null;
  storagePath: string | null;
  mimeType: string;
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

async function main() {
  const argv = process.argv.slice(2);
  const bookFilter = parseArg(argv, 'book');
  const batchFilter = parseArg(argv, 'batch');
  const sentenceFilter = parseArg(argv, 'sentence');
  const limit = Number(parseArg(argv, 'limit') ?? DEFAULT_LIMIT);
  const threshold = Number(parseArg(argv, 'threshold') ?? DEFAULT_THRESHOLD);

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  console.log('Fetching sentences and reference audio...');
  const [sentences, audioRows] = await Promise.all([
    fetchAll(
      supabase,
      'sentences',
      'id, japanese, import_batch_ids',
      user.id,
      (row): SentenceRow => ({
        id: String(row.id),
        japanese: String(row.japanese ?? ''),
        importBatchIds: Array.isArray(row.import_batch_ids)
          ? (row.import_batch_ids as string[])
          : [],
      }),
    ),
    fetchAll(
      supabase,
      'reference_audio',
      'sentence_id, book_id, storage_path, mime_type',
      user.id,
      (row): AudioRow => ({
        sentenceId: String(row.sentence_id),
        bookId: row.book_id ? String(row.book_id) : null,
        storagePath: row.storage_path ? String(row.storage_path) : null,
        mimeType: String(row.mime_type ?? 'audio/mp4'),
      }),
      'sentence_id',
    ),
  ]);

  const audioBySentence = new Map<string, AudioRow>();
  for (const row of audioRows) {
    if (!audioBySentence.has(row.sentenceId)) audioBySentence.set(row.sentenceId, row);
  }
  const sentenceById = new Map(sentences.map((s) => [s.id, s]));

  let candidates = sentences.filter((s) => audioBySentence.has(s.id));
  if (sentenceFilter) candidates = candidates.filter((s) => s.id === sentenceFilter);
  if (batchFilter) candidates = candidates.filter((s) => s.importBatchIds.includes(batchFilter));
  if (bookFilter) {
    candidates = candidates.filter((s) => audioBySentence.get(s.id)?.bookId === bookFilter);
  }
  candidates = candidates.slice(0, limit);

  console.log(
    `Checking ${candidates.length} sentence(s) (of ${sentences.filter((s) => audioBySentence.has(s.id)).length} with reference audio) against a threshold of ${threshold}...\n`,
  );

  let flagged = 0;
  let unavailable = 0;
  for (const sentence of candidates) {
    const audio = audioBySentence.get(sentence.id);
    if (!audio?.storagePath) continue;
    const { data: blob, error } = await supabase.storage
      .from(AUDIO_BUCKET)
      .download(audio.storagePath);
    if (error || !blob) {
      console.log(`  [skip] ${sentence.id}: couldn't download audio (${error?.message})`);
      continue;
    }
    const audioBase64 = Buffer.from(await blob.arrayBuffer()).toString('base64');
    let result;
    try {
      result = await validateTranscript(audioBase64, audio.mimeType, sentence.japanese);
    } catch (err) {
      console.log(`  [error] ${sentence.id}: ${(err as Error).message}`);
      continue;
    }
    if (result.similarity === null) {
      unavailable += 1;
      console.log(`  [unavailable] ${sentence.id}: ${result.reason}`);
      continue;
    }
    if (result.similarity < threshold) {
      flagged += 1;
      console.log(`  [FLAG ${result.similarity.toFixed(2)}] ${sentence.id}`);
      console.log(`      stored: ${sentence.japanese}`);
      console.log(`      heard:  ${result.asrText}`);
    }
  }

  console.log(
    `\nDone. ${flagged} flagged, ${unavailable} ASR-unavailable, ${candidates.length - flagged - unavailable} clean (of ${candidates.length} checked).`,
  );
  if (flagged) {
    console.log('Flagged sentences need a human listen — this is a signal, not a verdict.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
