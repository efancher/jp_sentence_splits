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

export const CHUNK_FRAGMENTS = 40;
/** One try plus one automatic retry. */
export const MAX_ATTEMPTS_PER_CHUNK = 2;

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
  const warnings = checkCombinedReply({ reply, sections, rows, transcript: chunk, options: NO_EXTRAS });
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
  isCancelled: () => boolean;
}): Promise<ChunkRunResult> {
  const { chunks, run } = input;
  const replies = chunks.map((_, i) => input.replies[i] ?? null);
  for (let index = 0; index < chunks.length; index++) {
    if (replies[index]) continue;
    const chunk = chunks[index]!;
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CHUNK; attempt++) {
      if (input.isCancelled()) return { replies, failure: null, cancelled: true };
      input.onProgress({ index, total: chunks.length, attempt, backend: null });
      try {
        const { reply, backend } = await run(buildChunkPrompt(chunk, index, chunks.length));
        input.onProgress({ index, total: chunks.length, attempt, backend });
        const problem = validateChunkReply(reply, chunk);
        if (problem) {
          lastError = problem;
          continue;
        }
        replies[index] = reply;
        input.onChunkDone(index, reply);
        break;
      } catch (err) {
        if (input.isCancelled()) return { replies, failure: null, cancelled: true };
        lastError = err instanceof Error ? err.message : 'Assistant failed';
      }
    }
    if (!replies[index]) return { replies, failure: { index, error: lastError }, cancelled: false };
  }
  return { replies, failure: null, cancelled: false };
}
