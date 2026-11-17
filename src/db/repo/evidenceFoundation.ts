// ---------------------------------------------------------------------------
// Evidence-model foundation (Phase 7.1, docs/STATUS.md). Additive only — no
// existing review flow is touched. StudyItem.subjectType already supports
// 'vocabularyItem' (Phase 1); these helpers were the first callers of that
// capability, so word-level (not just sentence-level) FSRS state became
// usable by a future review UI without any further schema change. Wraps the
// primitives in `reviewScheduling.ts`.
// ---------------------------------------------------------------------------

import type { Review, ReviewRating, StudyActivityType, StudyItem } from '../../domain/types';
import { ensureStudyItem, recordReview } from './reviewScheduling';

// ---------------------------------------------------------------------------

/** Get-or-create a vocabulary-item-level study item for a given dimension (activityType). */
export async function ensureVocabularyStudyItem(
  vocabularyItemId: string,
  activityType: StudyActivityType,
): Promise<StudyItem> {
  return ensureStudyItem('vocabularyItem', vocabularyItemId, activityType);
}

/**
 * Records evidence from an unprompted, opportunistic recognition of a
 * vocabulary item while reading (Phase 7.8, docs brief §9/§16) — as
 * opposed to a scheduled review-queue card. Always targets the word's
 * `reading_retrieval` study item (get-or-create, same as the formal card),
 * so natural-encounter evidence feeds the same FSRS schedule a learner
 * would otherwise only advance via ReviewPage — just from a different
 * sentence than whichever one originally seeded that study item, recorded
 * via `contextSentenceId`.
 */
export async function recordNaturalEncounter(input: {
  vocabularyItemId: string;
  sentenceId: string;
  rating: ReviewRating;
}): Promise<{ review: Review; studyItem: StudyItem }> {
  const studyItem = await ensureVocabularyStudyItem(
    input.vocabularyItemId,
    'reading_retrieval',
  );
  return recordReview({
    studyItemId: studyItem.id,
    rating: input.rating,
    source: 'natural_encounter',
    contextSentenceId: input.sentenceId,
  });
}
