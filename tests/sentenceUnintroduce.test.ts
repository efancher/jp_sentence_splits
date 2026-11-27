import { describe, expect, it } from 'vitest';
import { planUnintroduce } from '../src/lib/sentenceUnintroduce';

const membership = (sentenceId: string, status = 'unstarted') => ({
  sentenceId,
  bookId: 'book_1',
  chapterId: 'ch_1',
  status,
});

describe('planUnintroduce', () => {
  it('resets walked sentences and retires all of their cards', () => {
    const plan = planUnintroduce(
      ['a', 'b', 'c'],
      [
        { sentenceId: 'a', action: 'walkthrough_completed', timestamp: '2026-11-01T00:00:00Z' },
        { sentenceId: 'c', action: 'gist_check', timestamp: '2026-11-01T00:00:00Z' },
      ],
      [
        { id: 'i1', subjectId: 'a', activityType: 'reading_in_context' },
        { id: 'i2', subjectId: 'a', activityType: 'listening' },
        { id: 'i3', subjectId: 'b', activityType: 'ear_tiles' },
      ],
      [membership('a'), membership('b'), membership('c')],
    );
    expect(plan.sentenceIds).toEqual(['a', 'b']);
    expect(plan.resetEvents).toEqual([{ sentenceId: 'a', bookId: 'book_1', chapterId: 'ch_1' }]);
    expect(plan.retireItemIds).toEqual(['i1', 'i2', 'i3']);
  });

  it('leaves sentences with a started book membership alone and reports them', () => {
    const plan = planUnintroduce(
      ['a'],
      [{ sentenceId: 'a', action: 'walkthrough_completed', timestamp: '2026-11-01T00:00:00Z' }],
      [{ id: 'i1', subjectId: 'a', activityType: 'reading_in_context' }],
      [membership('a', 'learning')],
    );
    expect(plan.sentenceIds).toEqual([]);
    expect(plan.retireItemIds).toEqual([]);
    expect(plan.skippedStartedMembership).toEqual(['a']);
  });

  it('is idempotent: a walkthrough cancelled by a later reset (and with no cards) needs nothing', () => {
    const plan = planUnintroduce(
      ['a'],
      [
        { sentenceId: 'a', action: 'walkthrough_completed', timestamp: '2026-11-01T00:00:00Z' },
        { sentenceId: 'a', action: 'walkthrough_reset', timestamp: '2026-11-27T00:00:00Z' },
      ],
      [],
      [membership('a')],
    );
    expect(plan.sentenceIds).toEqual([]);
    expect(plan.resetEvents).toEqual([]);
  });

  it('plans nothing for sentences that are not introduced', () => {
    const plan = planUnintroduce(['a'], [{ sentenceId: 'a', action: 'target_practice', timestamp: '2026-11-01T00:00:00Z' }], [], [membership('a')]);
    expect(plan.sentenceIds).toEqual([]);
  });
});
