import { describe, expect, it } from 'vitest';

import type { FsrsState, GameRound, GameRoundItem } from '../src/domain/types';
import {
  describePick,
  describeRound,
  isInSignalPool,
  pickDifficultyTier,
  pickItems,
  recentRoundsAccuracy,
  signalPoolSizes,
  summarizeCardStats,
  type PickerCandidate,
  type PickerStats,
} from '../src/lib/gamePicker';

const NOW = new Date('2026-09-19T12:00:00Z');

function fsrs(overrides: Partial<FsrsState> = {}): FsrsState {
  return {
    due: NOW.toISOString(),
    stability: 30,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 30,
    learningSteps: 0,
    reps: 5,
    lapses: 0,
    state: 'review',
    lastReview: NOW.toISOString(),
    ...overrides,
  };
}

function stats(overrides: Partial<PickerStats> = {}): PickerStats {
  return { hasCard: true, lapses: 0, retrievability: 0.95, matureCards: true, ...overrides };
}

function cand(id: string, overrides: Partial<PickerStats> = {}): PickerCandidate {
  return { id, stats: stats(overrides) };
}

describe('summarizeCardStats', () => {
  it('treats never-reviewed (new) cards as carrying no signal', () => {
    const result = summarizeCardStats([fsrs({ state: 'new', lastReview: undefined })], NOW);
    expect(result).toEqual({ hasCard: false, lapses: 0, retrievability: null, matureCards: false });
    expect(summarizeCardStats([], NOW).hasCard).toBe(false);
  });

  it('sums lapses and takes the weakest card recall across activity types', () => {
    const result = summarizeCardStats(
      [
        fsrs({ lapses: 1 }),
        fsrs({ lapses: 2, lastReview: '2026-06-01T00:00:00Z', stability: 5 }),
      ],
      NOW,
    );
    expect(result.lapses).toBe(3);
    const healthy = summarizeCardStats([fsrs()], NOW).retrievability!;
    expect(result.retrievability).toBeLessThan(healthy);
    expect(result.matureCards).toBe(true);
  });

  it('is not mature while any card is short-interval or relearning', () => {
    expect(summarizeCardStats([fsrs({ scheduledDays: 5 })], NOW).matureCards).toBe(false);
    expect(summarizeCardStats([fsrs(), fsrs({ state: 'relearning' })], NOW).matureCards).toBe(false);
  });
});

describe('isInSignalPool', () => {
  it('weak needs a real lapse; stale needs decayed recall; strong needs mature + high recall', () => {
    expect(isInSignalPool(stats({ lapses: 1 }), 'weak')).toBe(true);
    expect(isInSignalPool(stats({ lapses: 0 }), 'weak')).toBe(false);
    expect(isInSignalPool(stats({ retrievability: 0.6 }), 'stale')).toBe(true);
    expect(isInSignalPool(stats({ retrievability: 0.95 }), 'stale')).toBe(false);
    expect(isInSignalPool(stats(), 'strong')).toBe(true);
    expect(isInSignalPool(stats({ matureCards: false }), 'strong')).toBe(false);
    expect(isInSignalPool(stats({ retrievability: 0.8 }), 'strong')).toBe(false);
    expect(isInSignalPool(stats({ hasCard: false, retrievability: null }), 'stale')).toBe(false);
  });
});

describe('pickItems', () => {
  const pool = [
    cand('a', { lapses: 3, retrievability: 0.5 }),
    cand('b', { lapses: 1, retrievability: 0.7 }),
    cand('c', { lapses: 1, retrievability: 0.4 }),
    cand('d', { lapses: 0, retrievability: 0.6 }),
    cand('e', {}),
    cand('f', { hasCard: false, retrievability: null, matureCards: false }),
  ];

  it('picks only from the requested signal pool when it is big enough', () => {
    const result = pickItems(pool, { signal: 'weak', n: 3, seed: 's' });
    expect(result.signal).toBe('weak');
    expect(result.fellBack).toBe(false);
    expect(result.poolSize).toBe(3);
    expect(result.items.map((i) => i.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('is deterministic for a seed and varies with it', () => {
    const big = Array.from({ length: 30 }, (_, i) => cand(`w${i}`, { lapses: 1 }));
    const one = pickItems(big, { signal: 'weak', n: 3, seed: 'x' }).items.map((i) => i.id);
    expect(pickItems(big, { signal: 'weak', n: 3, seed: 'x' }).items.map((i) => i.id)).toEqual(one);
    const others = ['y', 'z', 'q'].map((seed) =>
      pickItems(big, { signal: 'weak', n: 3, seed }).items.map((i) => i.id).join(),
    );
    expect(new Set([one.join(), ...others]).size).toBeGreaterThan(1);
  });

  it('samples only from the top-ranked slice (worst weak words first)', () => {
    const big = Array.from({ length: 40 }, (_, i) => cand(`w${i}`, { lapses: i + 1 }));
    const result = pickItems(big, { signal: 'weak', n: 3, seed: 's' });
    // top 9 by lapses => w31..w39
    for (const item of result.items) expect(Number(item.id.slice(1))).toBeGreaterThanOrEqual(31);
  });

  it('falls back to the next signal, saying so, when the pool is too small', () => {
    const result = pickItems(pool, { signal: 'weak', n: 4, seed: 's' });
    // weak has 3 (<4); stale: b .7, c .4, d .6, a .5 => 4
    expect(result.fellBack).toBe(true);
    expect(result.signal).toBe('stale');
    expect(result.requested).toBe('weak');
    expect(describeRound(result)).toMatch(/Not enough material for “Weak spots” yet — playing “Fading” instead/);
  });

  it('falls back to any eligible candidate rather than an empty round', () => {
    const tiny = [cand('x', { hasCard: false, retrievability: null, matureCards: false }), cand('y')];
    const result = pickItems(tiny, { signal: 'weak', n: 2, seed: 's' });
    expect(result.signal).toBe('any');
    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.id)).toEqual(expect.arrayContaining(['x', 'y']));
  });

  it('the `any` fallback samples the whole pool, not the same first few items', () => {
    // 40 candidates, none in any signal pool -> `any`
    const big = Array.from({ length: 40 }, (_, i) =>
      cand(`w${i}`, { hasCard: false, retrievability: null, matureCards: false }),
    );
    const seen = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const result = pickItems(big, { signal: 'weak', n: 3, seed });
      expect(result.signal).toBe('any');
      for (const item of result.items) seen.add(item.id);
    }
    expect(seen.size).toBeGreaterThan(9); // > the old top-9 slice
  });

  it('returns an empty round only when there are no eligible candidates at all', () => {
    const result = pickItems([], { signal: 'weak', n: 3, seed: 's' });
    expect(result.items).toEqual([]);
    expect(result.signal).toBe('any');
  });

  it('a "harder" difficulty narrows the sampled slice toward the most extreme end of the ranking', () => {
    const big = Array.from({ length: 40 }, (_, i) => cand(`w${i}`, { lapses: i + 1 }));
    // standard: top n*3=9 => w31..w39; harder: top round(n*1.5)=5 => w35..w39.
    const harder = pickItems(big, { signal: 'weak', n: 3, seed: 's', difficulty: 'harder' });
    for (const item of harder.items) expect(Number(item.id.slice(1))).toBeGreaterThanOrEqual(35);
  });

  it('an "easier" difficulty widens the sampled slice, diluting in gentler items', () => {
    const big = Array.from({ length: 40 }, (_, i) => cand(`w${i}`, { lapses: i + 1 }));
    // easier: top n*6=18 => w22..w39, wider than the standard w31..w39 slice.
    const seen = new Set<number>();
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const result = pickItems(big, { signal: 'weak', n: 3, seed, difficulty: 'easier' });
      for (const item of result.items) seen.add(Number(item.id.slice(1)));
    }
    expect(Math.min(...seen)).toBeLessThan(31);
  });

  it('difficulty never changes which signal is used, including the `any` fallback', () => {
    const tiny = [cand('x', { hasCard: false, retrievability: null, matureCards: false }), cand('y')];
    const result = pickItems(tiny, { signal: 'weak', n: 2, seed: 's', difficulty: 'harder' });
    expect(result.signal).toBe('any');
    expect(result.items).toHaveLength(2);
  });
});

describe('recentRoundsAccuracy / pickDifficultyTier', () => {
  function roundItem(correct: boolean): GameRoundItem {
    return { ref: 'x', correct, cluesUsed: 0, wrongGuesses: 0, points: correct ? 1 : 0, ms: 100 };
  }

  function round(
    gameId: string,
    timestamp: string,
    outcomes: boolean[],
  ): GameRound {
    return {
      id: `r_${timestamp}`,
      timestamp,
      gameId,
      signal: 'weak',
      poolSize: 10,
      items: outcomes.map(roundItem),
    };
  }

  it('is null with no rounds for that game', () => {
    expect(recentRoundsAccuracy([], 'word-detective')).toBeNull();
    expect(
      recentRoundsAccuracy([round('other-game', '2026-09-20T00:00:00Z', [true])], 'word-detective'),
    ).toBeNull();
  });

  it('only looks at the most recent `window` rounds for that game, across all its items', () => {
    const rounds = [
      round('word-detective', '2026-09-18T00:00:00Z', [false, false, false]), // oldest, outside window
      round('word-detective', '2026-09-19T00:00:00Z', [true, true]),
      round('word-detective', '2026-09-20T00:00:00Z', [true, false]),
      round('word-detective', '2026-09-21T00:00:00Z', [true]),
    ];
    // window=3 most recent (09-19..09-21): 4 correct / 5 items = 0.8
    expect(recentRoundsAccuracy(rounds, 'word-detective', 3)).toBeCloseTo(0.8);
  });

  it('maps recent accuracy to a difficulty tier with standard in the middle band', () => {
    expect(pickDifficultyTier(null)).toBe('standard');
    expect(pickDifficultyTier(0.9)).toBe('harder');
    expect(pickDifficultyTier(0.85)).toBe('harder');
    expect(pickDifficultyTier(0.6)).toBe('standard');
    expect(pickDifficultyTier(0.4)).toBe('easier');
    expect(pickDifficultyTier(0.1)).toBe('easier');
  });
});

describe('signalPoolSizes / describePick', () => {
  it('counts each signal independently', () => {
    const sizes = signalPoolSizes([
      cand('a', { lapses: 2, retrievability: 0.5 }),
      cand('b'),
      cand('c', { hasCard: false, retrievability: null, matureCards: false }),
    ]);
    expect(sizes).toEqual({ weak: 1, stale: 1, strong: 1 });
  });

  it('describes why an item was picked', () => {
    expect(describePick('weak', stats({ lapses: 3 }))).toBe('Lapsed 3× in review.');
    expect(describePick('stale', stats({ retrievability: 0.62 }))).toBe('Predicted recall ~62%.');
    expect(describePick('any', stats({ hasCard: false, retrievability: null }))).toMatch(
      /haven't reviewed/,
    );
  });
});
