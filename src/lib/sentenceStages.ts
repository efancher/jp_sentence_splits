/**
 * Per-sentence stage rollup for book / chapter progress bars. Each sentence
 * lands in exactly one stage (furthest reached wins), so a bar's segments
 * always sum to the sentence total. Pure — callers supply the facts.
 */

export const SENTENCE_STAGES = [
  'new',
  'vocab_confirmed',
  'studying',
  'complete',
  'graduated',
] as const;

export type SentenceStage = (typeof SENTENCE_STAGES)[number];

export const SENTENCE_STAGE_LABELS: Record<SentenceStage, string> = {
  new: 'New',
  vocab_confirmed: 'Vocab confirmed',
  studying: 'Studying',
  complete: 'Complete',
  graduated: 'Graduated',
};

export interface SentenceStageInput {
  membershipStatus: 'unstarted' | 'in_progress' | 'needs_review' | 'complete';
  vocabConfirmed: boolean;
  graduated: boolean;
}

export function sentenceStage(input: SentenceStageInput): SentenceStage {
  if (input.graduated) return 'graduated';
  if (input.membershipStatus === 'complete') return 'complete';
  if (
    input.membershipStatus === 'in_progress' ||
    input.membershipStatus === 'needs_review'
  ) {
    return 'studying';
  }
  return input.vocabConfirmed ? 'vocab_confirmed' : 'new';
}

export type StageCounts = Record<SentenceStage, number>;

export function countStages(inputs: SentenceStageInput[]): {
  total: number;
  counts: StageCounts;
} {
  const counts: StageCounts = {
    new: 0,
    vocab_confirmed: 0,
    studying: 0,
    complete: 0,
    graduated: 0,
  };
  for (const input of inputs) counts[sentenceStage(input)] += 1;
  return { total: inputs.length, counts };
}
