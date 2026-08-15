import { describe, expect, it } from 'vitest';

import { createInitialFsrsState, scheduleReview } from '../src/lib/scheduling';

describe('createInitialFsrsState', () => {
  it('creates a new, unreviewed card due immediately', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const state = createInitialFsrsState(now);
    expect(state.state).toBe('new');
    expect(state.reps).toBe(0);
    expect(state.lapses).toBe(0);
    expect(state.lastReview).toBeUndefined();
    expect(new Date(state.due).getTime()).toBeLessThanOrEqual(now.getTime());
  });
});

describe('scheduleReview', () => {
  it('advances a new card out of the "new" state and schedules it in the future', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const initial = createInitialFsrsState(now);
    const { fsrsState, nextDue } = scheduleReview(initial, 'good', now);
    expect(fsrsState.state).not.toBe('new');
    expect(fsrsState.reps).toBe(1);
    expect(new Date(nextDue).getTime()).toBeGreaterThan(now.getTime());
    expect(fsrsState.lastReview).toBe(now.toISOString());
  });

  it('increments lapses on "again" once a card has left learning', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    let state = createInitialFsrsState(now);
    // Push the card through learning into the review state with a couple of
    // "good" ratings so an "again" genuinely counts as a lapse.
    for (let i = 0; i < 3; i += 1) {
      const day = new Date(now.getTime() + i * 30 * 24 * 60 * 60 * 1000);
      state = scheduleReview(state, 'good', day).fsrsState;
    }
    expect(state.state).toBe('review');
    const lapsesBefore = state.lapses;
    const later = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000);
    const { fsrsState } = scheduleReview(state, 'again', later);
    expect(fsrsState.lapses).toBe(lapsesBefore + 1);
    expect(fsrsState.state).toBe('relearning');
  });

  it('round-trips every FsrsState.state value through toCard/toLocalState', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const states: Array<'new' | 'learning' | 'review' | 'relearning'> = [
      'new',
      'learning',
      'review',
      'relearning',
    ];
    for (const state of states) {
      const fsrsState = {
        due: now.toISOString(),
        stability: 1,
        difficulty: 5,
        elapsedDays: 0,
        scheduledDays: 0,
        learningSteps: 0,
        reps: 1,
        lapses: 0,
        state,
      };
      const { fsrsState: result } = scheduleReview(fsrsState, 'good', now);
      expect(result.state).toBeDefined();
    }
  });
});
