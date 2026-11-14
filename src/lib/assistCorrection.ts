/**
 * Dedicated recognition-fix pass for assistant runs: one cheap call per
 * chunk asking ONLY for minimal JSON diffs against the ASR text, which are
 * validated mechanically (exact substring, real change, in-range segment)
 * and applied in code — never trusted free-form. Fail-open by design: a
 * missing, rejected or failed reply just leaves the chunk as transcribed,
 * and nothing here can stop a run.
 *
 * This replaces the old inline "fix obvious mis-recognitions" instruction
 * inside the segment+translate prompt, so every deviation from the raw ASR
 * text becomes a logged, timestamped line a reviewer can listen back to —
 * and the segment+translate call gets a single-job prompt instead of
 * doing translation, segmentation and ASR correction at once.
 */
import { runPool } from './assistChunks';
import { formatWizardTimestamp, type WizardTranscriptSeg } from './miningTranscript';

export type CorrectionConfidence = 'high' | 'med' | 'low';

/** One proposed minimal fix, keyed to the global transcript segment index. */
export interface CorrectionProposal {
  seg: number;
  original: string;
  replacement: string;
  reason: string;
  confidence: CorrectionConfidence;
}

/** A proposal that passed validation and was applied; carries the time for display. */
export interface AppliedCorrection extends CorrectionProposal {
  startMs: number;
}

const CONFIDENCE = new Set<string>(['high', 'med', 'low']);

/**
 * Prompt sent as its own assistant call before segmentation. Deliberately
 * narrow: propose diffs only, output only a JSON array. Rules follow the
 * evaluation that ran this prompt against three backends on real episode
 * transcripts (substring-validated, no free rewriting).
 */
export function buildCorrectionPrompt(
  chunk: WizardTranscriptSeg[],
  offset: number,
  chunkIndex: number,
  totalChunks: number,
): string {
  const lines = chunk.map((seg, i) => {
    const flag = seg.lowConfidence ? '!' : '';
    return `F${offset + i} [${formatWizardTimestamp(seg.startMs)}]${flag} ${seg.text.trim()}`;
  });
  return [
    `You are a careful Japanese ASR correction reviewer. Below are timed segments from part ${chunkIndex + 1} of ${totalChunks} of one podcast transcript (format: F<index> [m:ss], "!" marks low ASR confidence).`,
    '',
    'Whisper\u2019s common errors here, in rough order of importance:',
    '- Kanji/homophone spelling chosen wrong (e.g. \u4ee3\u540d or \u6697\u9ed2\u306e\u4e86\u89e3 rendered as wrong characters)',
    '- Names (people, shows, brands) rendered phonetically',
    '- Learner/domain terms mangled (JLPT, \u30b7\u30e3\u30c9\u30a6\u30a4\u30f3\u30b0, \u767a\u97f3)',
    '',
    'Propose CORRECTIONS ONLY. Strict rules:',
    '1. Only what sounds close and is plausibly what was actually said. Never rewrite style; never add, remove or move punctuation.',
    '2. Quote `original` as an exact substring of ONE line (short: the error itself plus just enough to locate it) and `replacement` as the minimal change.',
    '3. `seg` is the F-number of the line the `original` appears in.',
    '4. If not fairly sure, use confidence "low" rather than omit; never guess wildly.',
    '5. A word simply written in hiragana where you would write kanji is not an error. Informal spoken wording is not an error.',
    '6. Do not merge, reorder, translate or comment on lines.',
    '',
    'Output ONLY a JSON array, no markdown fences, no other text:',
    '[{"seg": <int>, "original": "...", "replacement": "...", "reason": "<=12 words", "confidence": "high|med|low"}]',
    'If you find no corrections, output [].',
    '',
    'TRANSCRIPT:',
    ...lines,
  ].join('\n');
}

/**
 * Extract the JSON array from a reply and validate every entry mechanically:
 * `seg` inside this chunk, `original` a real substring of that segment's
 * text, `replacement` a non-empty actual change. Returns the survivors plus
 * the count dropped (a malformed reply is simply "no corrections").
 */
export function parseCorrections(
  reply: string,
  chunk: WizardTranscriptSeg[],
  offset: number,
): { accepted: CorrectionProposal[]; rejected: number } {
  const match = reply.match(/\[[\s\S]*\]/);
  if (!match) return { accepted: [], rejected: 0 };
  let data: unknown;
  try {
    data = JSON.parse(match[0]);
  } catch {
    return { accepted: [], rejected: 0 };
  }
  if (!Array.isArray(data)) return { accepted: [], rejected: 0 };
  const accepted: CorrectionProposal[] = [];
  let rejected = 0;
  for (const raw of data) {
    if (typeof raw !== 'object' || raw === null) {
      rejected += 1;
      continue;
    }
    const e = raw as Record<string, unknown>;
    const local = typeof e.seg === 'number' && Number.isInteger(e.seg) ? e.seg - offset : -1;
    const seg = local >= 0 && local < chunk.length ? chunk[local] : undefined;
    const original = typeof e.original === 'string' ? e.original : '';
    const replacement = typeof e.replacement === 'string' ? e.replacement : '';
    if (
      !seg ||
      !original ||
      !replacement ||
      original === replacement ||
      !seg.text.includes(original)
    ) {
      rejected += 1;
      continue;
    }
    accepted.push({
      seg: e.seg as number,
      original,
      replacement,
      reason: typeof e.reason === 'string' ? e.reason.slice(0, 160) : '',
      confidence: CONFIDENCE.has(String(e.confidence)) ? (e.confidence as CorrectionConfidence) : 'med',
    });
  }
  return { accepted, rejected };
}

/**
 * Apply accepted proposals to the transcript: first occurrence per segment,
 * in proposal order; a proposal whose `original` no longer matches (an
 * earlier fix consumed it) is skipped, not forced. Returns new segments and
 * the corrections that actually landed, with times for the audit list.
 */
export function applyCorrections(
  segs: WizardTranscriptSeg[],
  proposals: CorrectionProposal[],
): { segs: WizardTranscriptSeg[]; applied: AppliedCorrection[] } {
  const out = segs.slice();
  const applied: AppliedCorrection[] = [];
  for (const p of proposals) {
    const seg = out[p.seg];
    if (!seg || !seg.text.includes(p.original)) continue;
    out[p.seg] = { ...seg, text: seg.text.replace(p.original, p.replacement) };
    applied.push({ ...p, startMs: seg.startMs });
  }
  return { segs: out, applied };
}

/** Re-apply a stored correction list to a transcript (review stage rehydration). */
export function applyCorrectionsToTranscript(
  segs: WizardTranscriptSeg[],
  corrections: AppliedCorrection[],
): WizardTranscriptSeg[] {
  return applyCorrections(segs, corrections).segs;
}

export interface CorrectionChunkResult {
  replies: (string | null)[];
  /** Accepted proposals per chunk index, from the stored/newest reply (re-derived on resume). */
  corrections: CorrectionProposal[][];
  cancelled: boolean;
}

/**
 * Run the correction call per chunk with the run's concurrency. Unlike
 * segment parts, failures are never fatal: the reply is kept as-is for
 * resume, and each chunk's proposals are re-derived mechanically, so a
 * resumed run applies exactly the fixes the stored replies contain.
 */
export async function runCorrectionChunks(input: {
  chunks: WizardTranscriptSeg[][];
  replies: (string | null)[];
  run: (prompt: string, label?: string) => Promise<{ reply: string; backend: string | null }>;
  onChunkDone: (index: number, reply: string) => void;
  onProgress: (index: number, total: number, backend: string | null) => void;
  onNote?: (text: string) => void;
  isCancelled: () => boolean;
  concurrency?: number;
}): Promise<CorrectionChunkResult> {
  const { chunks, run } = input;
  const replies = chunks.map((_, i) => input.replies[i] ?? null);
  const offsets = chunks.map((_, i) => chunks.slice(0, i).reduce((n, c) => n + c.length, 0));
  let cancelled = false;

  const doChunk = async (index: number): Promise<void> => {
    if (input.isCancelled()) {
      cancelled = true;
      return;
    }
    const chunk = chunks[index]!;
    const label = `corrections part ${index + 1} of ${chunks.length}`;
    input.onProgress(index, chunks.length, null);
    try {
      const { reply, backend } = await run(buildCorrectionPrompt(chunk, offsets[index]!, index, chunks.length), label);
      input.onProgress(index, chunks.length, backend);
      replies[index] = reply;
      input.onChunkDone(index, reply);
      const { accepted, rejected } = parseCorrections(reply, chunk, offsets[index]!);
      const dropped = rejected > 0 ? `, ${rejected} rejected` : '';
      input.onNote?.(`${label}: ${accepted.length} fix(es) proposed${dropped} (${backend ?? 'assistant'})`);
    } catch (err) {
      if (input.isCancelled()) {
        cancelled = true;
        return;
      }
      input.onNote?.(`${label}: skipped (${err instanceof Error ? err.message : 'assistant failed'})`);
    }
  };

  await runPool(
    chunks.map((_, index) => index).filter((index) => replies[index] === null),
    input.concurrency ?? 1,
    doChunk,
    () => cancelled,
  );

  const corrections = chunks.map((chunk, index) => {
    const reply = replies[index];
    return reply ? parseCorrections(reply, chunk, offsets[index]!).accepted : [];
  });
  return { replies, corrections, cancelled };
}
