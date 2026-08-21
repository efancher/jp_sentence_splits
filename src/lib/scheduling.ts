import { createEmptyCard, fsrs, Rating, State } from 'ts-fsrs';
import type { Card } from 'ts-fsrs';

import type {
  ErrorClassification,
  FsrsState,
  ReviewRating,
  StudyActivityType,
  StudyItem,
  StudySubjectType,
} from '../domain/types';

/**
 * Thin wrapper around ts-fsrs (docs/UNIFIED_APP_ARCHITECTURE.md §10). Pure
 * functions only — no knowledge of sentences/vocabulary/UI. `FsrsState` is
 * shaped to match ts-fsrs's own `Card`, so the mapping here is a straight
 * field-for-field conversion.
 */

const scheduler = fsrs();

const RATING_TO_GRADE = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
} as const satisfies Record<ReviewRating, Rating>;

const STATE_TO_LOCAL: Record<State, FsrsState['state']> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

const LOCAL_TO_STATE: Record<FsrsState['state'], State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

function toLocalState(card: Card): FsrsState {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_TO_LOCAL[card.state],
    lastReview: card.last_review?.toISOString(),
  };
}

function toCard(fsrsState: FsrsState): Card {
  return {
    due: new Date(fsrsState.due),
    stability: fsrsState.stability,
    difficulty: fsrsState.difficulty,
    elapsed_days: fsrsState.elapsedDays,
    scheduled_days: fsrsState.scheduledDays,
    learning_steps: fsrsState.learningSteps,
    reps: fsrsState.reps,
    lapses: fsrsState.lapses,
    state: LOCAL_TO_STATE[fsrsState.state],
    last_review: fsrsState.lastReview ? new Date(fsrsState.lastReview) : undefined,
  };
}

/** A brand-new card, due immediately. */
export function createInitialFsrsState(now: Date = new Date()): FsrsState {
  return toLocalState(createEmptyCard(now));
}

export function scheduleReview(
  fsrsState: FsrsState,
  rating: ReviewRating,
  now: Date = new Date(),
): { fsrsState: FsrsState; nextDue: string } {
  const { card } = scheduler.next(toCard(fsrsState), now, RATING_TO_GRADE[rating]);
  const nextState = toLocalState(card);
  return { fsrsState: nextState, nextDue: nextState.due };
}

/**
 * Graduation (Phase 7.10, docs/STATUS.md): a study item stops being
 * treated as "due" once its FSRS interval has grown past
 * `minScheduledDays` while in the stable `review` state — the algorithm's
 * own signal that it's been retained long-term, not a separate tracked
 * concept. `minScheduledDays <= 0` disables graduation entirely (every
 * item keeps cycling through review forever), which is also
 * `AppSettings.graduationMinScheduledDays`'s "0 = off" convention.
 * Nothing about the FSRS state itself changes — this only affects whether
 * `getDueStudyItems` treats the item as due; the interval keeps growing
 * exactly as it would otherwise, so lowering the threshold later (or
 * disabling it) immediately un-graduates everything above the new bar.
 */
export function isGraduated(fsrsState: FsrsState, minScheduledDays: number): boolean {
  if (minScheduledDays <= 0) return false;
  return fsrsState.state === 'review' && fsrsState.scheduledDays >= minScheduledDays;
}

/**
 * Which subjects (sentence ids, vocabulary item ids, ...) count as fully
 * graduated — every study item that subject actually has (whichever
 * activity types were seeded for it) has crossed the threshold. A subject
 * with no study items at all is never graduated (nothing to have crossed
 * any threshold), and a subject with a mix of graduated/still-active
 * activity types isn't "done" either. Shared by the /vocabulary and book
 * detail "Graduated" badges (Phase 7.10 follow-up) — badge only, no
 * per-item override, matching this codebase's existing global-threshold-only
 * graduation control.
 */
export function computeGraduatedSubjectIds(
  studyItems: readonly StudyItem[],
  minScheduledDays: number,
): Set<string> {
  const bySubjectId = new Map<string, StudyItem[]>();
  for (const studyItem of studyItems) {
    const list = bySubjectId.get(studyItem.subjectId) ?? [];
    list.push(studyItem);
    bySubjectId.set(studyItem.subjectId, list);
  }
  const graduated = new Set<string>();
  for (const [subjectId, items] of bySubjectId) {
    if (items.every((item) => isGraduated(item.fsrsState, minScheduledDays))) {
      graduated.add(subjectId);
    }
  }
  return graduated;
}

/**
 * A vocabulary item counts as "shown proficiency" once FSRS has moved it
 * past its initial learning steps into `review` (or, after a later lapse,
 * `relearning` — reaching `relearning` requires having been in `review`
 * first, so it still implies the item was once successfully recalled).
 * `new`/`learning` mean it's never been successfully recalled yet.
 */
export function isVocabularyItemProficient(state: FsrsState['state']): boolean {
  return state === 'review' || state === 'relearning';
}

/**
 * Full-sentence review gating (user request, 2026-08-16), the "vocabulary
 * is confirmed, is it proficient" half: given the vocabulary items already
 * confirmed for a sentence, every one of them must have been shown
 * proficient — otherwise the sentence card just tests whether the learner
 * remembers vocabulary they haven't demonstrated recall of yet, which
 * isn't a useful signal. A sentence with zero confirmed vocabulary items
 * (a short sentence with nothing worth tracking, once vocabulary *has*
 * been reviewed — see isSentenceReadyForFullReview for the "has it even
 * been reviewed yet" half) has nothing left to gate on, so it's ready.
 */
export function isSentenceVocabularyReady(
  vocabularyItemIds: readonly string[],
  proficientVocabularyItemIds: ReadonlySet<string>,
): boolean {
  if (vocabularyItemIds.length === 0) return true;
  return vocabularyItemIds.every((id) => proficientVocabularyItemIds.has(id));
}

/**
 * Full-sentence review gating, the complete rule: a sentence isn't ready
 * for its "full sentence" review cards until its vocabulary has actually
 * been *reviewed* (`SentenceAnalysis.vocabularyReviewStatus === 'confirmed'`
 * — a brand-new or not-yet-analyzed sentence has this undefined/'unreviewed',
 * which must gate it too, not pass it through as "nothing to check" — that
 * was the bug in the first version of this rule, caught by the user asking
 * "does a new sentence just skip the gate?") *and*, once reviewed, every
 * vocabulary item confirmed for it must itself be proficient
 * (isSentenceVocabularyReady).
 */
export function isSentenceReadyForFullReview(
  vocabularyReviewStatus: 'unreviewed' | 'confirmed' | undefined,
  vocabularyItemIds: readonly string[],
  proficientVocabularyItemIds: ReadonlySet<string>,
): boolean {
  if (vocabularyReviewStatus !== 'confirmed') return false;
  return isSentenceVocabularyReady(vocabularyItemIds, proficientVocabularyItemIds);
}

/**
 * Auto-populate `Review.errorClassification`, but only where there's
 * concrete evidence, not a guess from a bare self-rating (the schema's own
 * documented intent — see `ErrorClassification`'s comment in
 * domain/types.ts — and this codebase's repeated "don't overbuild for
 * unproven need" precedent). Two evidence sources:
 * - A typed answer/selected choice that doesn't match what was expected
 *   (`reading_production`/`sentence_transformation`/`grammar_completion`/
 *   `grammar_contrast` cards) — the specific comparison already happened in the UI to show
 *   "✓/✗", this just reuses the same two strings to decide *why* it was
 *   wrong.
 * - A failed (`again`) contrastive-pair review — the card's entire premise
 *   is "can you tell these two words apart," so a miss is definitionally a
 *   `vocabulary_confusion`, no text comparison needed.
 * Comprehension/listening/reading_in_context/grammar_comprehension stay
 * unclassified: a bare
 * "again" there could mean anything, and guessing would be noise, not
 * signal.
 */
export function classifyReviewError(input: {
  subjectType: StudySubjectType;
  activityType: StudyActivityType;
  rating: ReviewRating;
  responseRaw?: string;
  expectedAnswer?: string;
}): ErrorClassification | undefined {
  if (
    input.responseRaw !== undefined &&
    input.expectedAnswer !== undefined &&
    input.responseRaw !== input.expectedAnswer
  ) {
    if (input.activityType === 'reading_production') return 'incorrect_reading';
    if (input.activityType === 'sentence_transformation') return 'grammar_misunderstanding';
    if (input.activityType === 'grammar_completion') return 'grammar_misunderstanding';
    if (input.activityType === 'grammar_contrast') return 'grammar_misunderstanding';
    if (input.activityType === 'pitch_accent') return 'pronunciation_difficulty';
  }
  if (input.subjectType === 'vocabularyConfusion' && input.rating === 'again') {
    return 'vocabulary_confusion';
  }
  return undefined;
}
