/**
 * Automated segment+translate for Quick import: split the transcript into
 * small chunks, send each to the server-side assistant (`runAssist`), check
 * each reply, and stitch the sentence lines back together. Each chunk's reply
 * is handed to `onChunkDone` as it lands so a stopped run resumes where it
 * left off. Retries are deliberately capped: a chunk gets
 * {@link MAX_ATTEMPTS_PER_CHUNK} tries, then the whole run stops and waits
 * for the user — so a misbehaving assistant can't spin unattended.
 */
import {
  END_MARKER,
  checkCombinedReply,
  formatCombinedPromptForAI,
  splitCombinedReply,
  type CombinedPromptOptions,
} from './combinedImportPrompt';
import { parseAiCombinedReply } from './miningQuickImport';
import type { WizardTranscriptSeg } from './miningTranscript';

/** Small parts keep each assistant call quick and cheap to redo; several can run side by side. */
export const CHUNK_FRAGMENTS = 20;
/** Most assistant calls one run may have in flight (the box may allow fewer). */
export const MAX_ASSIST_CONCURRENCY = 5;

export function clampConcurrency(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.min(MAX_ASSIST_CONCURRENCY, Math.max(1, n));
}

/**
 * Runs `worker` over `items` with up to `concurrency` in flight, handing out
 * items in order. Stops handing out new items once `shouldStop()` is true;
 * calls already in flight are left to finish. Workers must not throw.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(clampConcurrency(concurrency), items.length) }, async () => {
    while (!shouldStop()) {
      const index = next++;
      if (index >= items.length) return;
      await worker(items[index]!, index);
    }
  });
  await Promise.all(lanes);
}
/** One try plus one automatic retry. */
export const MAX_ATTEMPTS_PER_CHUNK = 2;

const OUT_OF_CREDITS_PATTERN =
  /usage limit|hit your limit|limit reached|quota|out of (?:extra )?(?:usage|credits?)|credit balance|insufficient (?:credits?|funds|quota)|billing/i;

/**
 * True when every backend named in the box's combined error ("codex: …; claude: …")
 * failed for lack of credits/usage, so retrying cannot help until the limit resets.
 */
export function isOutOfCreditsError(error: string): boolean {
  const parts = error.split(/;\s+(?=[a-z]+: )/).filter(Boolean);
  return parts.length > 0 && parts.every((part) => OUT_OF_CREDITS_PATTERN.test(part));
}

/** Failure text for a stopped run; an out-of-credits stop says so instead of reporting spent retries. */
export function describeStop(where: string, error: string, saved: string): string {
  if (isOutOfCreditsError(error)) {
    return `Stopped at ${where}: the assistants are out of credits or usage (${error}). ${saved} — resume once credits are back.`;
  }
  return `Stopped at ${where} after ${MAX_ATTEMPTS_PER_CHUNK} tries: ${error} ${saved} — resume to continue.`;
}

/** " (and N other parts also failed)" for the pieces after the first that the run could not finish. */
export function otherFailures(failures: readonly unknown[]): string {
  const others = failures.length - 1;
  return others > 0 ? `; ${others} other part${others === 1 ? '' : 's'} also failed` : '';
}

export const NO_EXTRAS: Required<CombinedPromptOptions> = {
  targets: false,
  constructions: false,
  walkthroughs: false,
  structure: false,
  comprehension: false,
  particles: false,
};

export function chunkTranscript<T>(segs: T[], size = CHUNK_FRAGMENTS): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < segs.length; i += size) chunks.push(segs.slice(i, i + size));
  return chunks;
}

export function buildChunkPrompt(chunk: WizardTranscriptSeg[], index: number, total: number): string {
  return formatCombinedPromptForAI(chunk, NO_EXTRAS, {
    inline: true,
    note:
      total > 1
        ? `This is excerpt ${index + 1} of ${total} of a longer transcript. Timestamps are absolute; keep them as given and cover only the lines below.`
        : undefined,
  });
}

/** Returns an error message when the reply for `chunk` is unusable, else null. */
export function validateChunkReply(reply: string, chunk: WizardTranscriptSeg[]): string | null {
  const sections = splitCombinedReply(reply);
  const last = chunk.at(-1);
  const rows = parseAiCombinedReply(sections.sentences, last?.endMs ?? 0);
  if (rows.length === 0) return 'The reply had no "[m:ss] japanese || english" lines.';
  const warnings = checkCombinedReply({
    reply,
    sections,
    rows,
    transcript: chunk,
    options: NO_EXTRAS,
  });
  return warnings[0] ?? null;
}

export function mergeChunkReplies(replies: string[]): string {
  const lines = replies.map((reply) => splitCombinedReply(reply).sentences);
  return ['=== SENTENCES ===', ...lines, END_MARKER].join('\n');
}

export interface ChunkProgress {
  index: number;
  total: number;
  attempt: number;
  backend: string | null;
}

export interface ChunkRunResult {
  replies: (string | null)[];
  failure: { index: number; error: string } | null;
  cancelled: boolean;
}

export async function runSegmentChunks(input: {
  chunks: WizardTranscriptSeg[][];
  /** Replies kept from an earlier run, by chunk index (null = still to do). */
  replies: (string | null)[];
  run: (prompt: string) => Promise<{ reply: string; backend: string | null }>;
  onChunkDone: (index: number, reply: string) => void;
  onProgress: (progress: ChunkProgress) => void;
  /** Optional activity-log line (rejected reply, failed call, saved part). */
  onNote?: (text: string) => void;
  isCancelled: () => boolean;
  /** Parts asked for at once (default 1). When one part fails the others in flight still finish and are saved. */
  concurrency?: number;
}): Promise<ChunkRunResult> {
  const { chunks, run } = input;
  const replies = chunks.map((_, i) => input.replies[i] ?? null);
  const failures: { index: number; error: string }[] = [];
  let cancelled = false;
  let outOfCredits = false;
  const pending = chunks.flatMap((_, index) => (replies[index] ? [] : [index]));

  const doChunk = async (index: number): Promise<void> => {
    const chunk = chunks[index]!;
    let lastError = '';
    const label = `sentences part ${index + 1} of ${chunks.length}`;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CHUNK; attempt++) {
      if (input.isCancelled()) {
        cancelled = true;
        return;
      }
      input.onProgress({ index, total: chunks.length, attempt, backend: null });
      try {
        const { reply, backend } = await run(buildChunkPrompt(chunk, index, chunks.length));
        input.onProgress({ index, total: chunks.length, attempt, backend });
        const problem = validateChunkReply(reply, chunk);
        if (problem) {
          lastError = problem;
          input.onNote?.(`${label}: reply rejected (${problem}) — attempt ${attempt} of ${MAX_ATTEMPTS_PER_CHUNK}`);
          continue;
        }
        replies[index] = reply;
        input.onChunkDone(index, reply);
        input.onNote?.(`${label}: saved (${backend ?? 'assistant'})`);
        return;
      } catch (err) {
        if (input.isCancelled()) {
          cancelled = true;
          return;
        }
        lastError = err instanceof Error ? err.message : 'Assistant failed';
        input.onNote?.(`${label}: call failed (${lastError}) — attempt ${attempt} of ${MAX_ATTEMPTS_PER_CHUNK}`);
        if (isOutOfCreditsError(lastError)) {
          outOfCredits = true;
          break;
        }
      }
    }
    failures.push({ index, error: lastError });
  };

  await runPool(pending, input.concurrency ?? 1, doChunk, () => cancelled || failures.length > 0 || outOfCredits);
  if (cancelled) return { replies, failure: null, cancelled: true };
  const first = failures.sort((a, b) => a.index - b.index)[0] ?? null;
  return { replies, failure: first, cancelled: false };
}
