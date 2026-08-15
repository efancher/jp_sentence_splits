import { createEmptyCard, fsrs, Rating, State } from 'ts-fsrs';
import type { Card } from 'ts-fsrs';

import type { FsrsState, ReviewRating } from '../domain/types';

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
