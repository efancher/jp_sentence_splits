/**
 * Per-sentence proficiency rollup for book / chapter progress bars. A
 * sentence's stage is that of its *weakest* study item (same "every item"
 * convention as `computeGraduatedSubjectIds`), so segments always sum to the
 * sentence total. Pure — callers supply the study items.
 */
import { isGraduated } from './scheduling';
import type { FsrsState, StudyItem } from '../domain/types';

export const SENTENCE_STAGES = [
  'new',
  'learning',
  'young',
  'mature',
  'graduated',
] as const;

export type SentenceStage = (typeof SENTENCE_STAGES)[number];

export const SENTENCE_STAGE_LABELS: Record<SentenceStage, string> = {
  new: 'New',
  learning: 'Learning',
  young: 'Young',
  mature: 'Mature',
  graduated: 'Graduated',
};

/** Interval (days) at which a review-state item counts as mature. */
export const MATURE_INTERVAL_DAYS = 21;

function itemRank(fsrs: FsrsState, graduationMinScheduledDays: number): number {
  if (fsrs.state === 'new') return 0;
  if (fsrs.state === 'learning' || fsrs.state === 'relearning') return 1;
  if (isGraduated(fsrs, graduationMinScheduledDays)) return 4;
  return fsrs.scheduledDays >= MATURE_INTERVAL_DAYS ? 3 : 2;
}

export function sentenceStage(
  items: readonly Pick<StudyItem, 'fsrsState'>[],
  graduationMinScheduledDays: number,
): SentenceStage {
  if (items.length === 0) return 'new';
  const rank = Math.min(
    ...items.map((item) => itemRank(item.fsrsState, graduationMinScheduledDays)),
  );
  return SENTENCE_STAGES[rank]!;
}

export type StageCounts = Record<SentenceStage, number>;

export function emptyStageCounts(): StageCounts {
  return { new: 0, learning: 0, young: 0, mature: 0, graduated: 0 };
}
