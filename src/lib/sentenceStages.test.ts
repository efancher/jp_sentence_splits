import { describe, expect, it } from 'vitest';
import { countStages, sentenceStage } from './sentenceStages';

describe('sentenceStage', () => {
  it('prefers the furthest stage reached', () => {
    expect(
      sentenceStage({ membershipStatus: 'complete', vocabConfirmed: true, graduated: true }),
    ).toBe('graduated');
    expect(
      sentenceStage({ membershipStatus: 'complete', vocabConfirmed: false, graduated: false }),
    ).toBe('complete');
    expect(
      sentenceStage({ membershipStatus: 'needs_review', vocabConfirmed: true, graduated: false }),
    ).toBe('studying');
    expect(
      sentenceStage({ membershipStatus: 'unstarted', vocabConfirmed: true, graduated: false }),
    ).toBe('vocab_confirmed');
    expect(
      sentenceStage({ membershipStatus: 'unstarted', vocabConfirmed: false, graduated: false }),
    ).toBe('new');
  });
});

describe('countStages', () => {
  it('sums segments to the total', () => {
    const { total, counts } = countStages([
      { membershipStatus: 'unstarted', vocabConfirmed: false, graduated: false },
      { membershipStatus: 'unstarted', vocabConfirmed: true, graduated: false },
      { membershipStatus: 'in_progress', vocabConfirmed: true, graduated: false },
      { membershipStatus: 'complete', vocabConfirmed: true, graduated: true },
    ]);
    expect(total).toBe(4);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(4);
    expect(counts.graduated).toBe(1);
  });
});
