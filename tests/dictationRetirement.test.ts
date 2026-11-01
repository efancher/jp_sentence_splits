import { describe, expect, it } from 'vitest';

import { planDictationRetirement } from '../src/lib/dictationRetirement';

const item = (id: string, subjectId: string, tile: number) => ({
  id,
  subjectId,
  activityType: `dictation_tile:${tile}`,
});

describe('planDictationRetirement', () => {
  it('keeps the most-reviewed tile of a sentence and retires the rest', () => {
    const items = [item('a0', 's1', 0), item('a1', 's1', 1), item('a2', 's1', 2)];
    const plan = planDictationRetirement(items, new Map([['a1', 3], ['a2', 1]]));
    expect(plan.keep).toEqual(['a1']);
    expect(plan.retire.sort()).toEqual(['a0', 'a2']);
    expect(plan.retiredWithReviews).toEqual(['a2']);
  });

  it('breaks ties toward the lowest tile index', () => {
    const plan = planDictationRetirement([item('b3', 's2', 3), item('b1', 's2', 1)], new Map());
    expect(plan.keep).toEqual(['b1']);
    expect(plan.retire).toEqual(['b3']);
  });

  it('leaves a lone card per sentence, and ignores other activity types', () => {
    const plan = planDictationRetirement(
      [item('c0', 's3', 0), { id: 'x', subjectId: 's3', activityType: 'ear_tiles' }, item('d0', 's4', 4)],
      new Map(),
    );
    expect(plan.keep.sort()).toEqual(['c0', 'd0']);
    expect(plan.retire).toEqual([]);
  });
});
