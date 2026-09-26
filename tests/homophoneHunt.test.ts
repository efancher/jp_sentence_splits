import { describe, expect, it } from 'vitest';

import type { GameRound } from '../src/domain/types';
import {
  buildHomophoneCandidates,
  buildHomophoneHistory,
  buildHomophoneRound,
  contrastPairKey,
  contrastStats,
  describeHomophonePick,
  trialKey,
} from '../src/lib/homophoneHunt';
import {
  findMinimalPairContrasts,
  type MinimalPairOccurrence,
} from '../src/lib/pitchAccentMinimalPairs';

// はし, 2 morae: 箸 atamadaka (1), 橋 heiban (0) — a real audible contrast.
const contrast = findMinimalPairContrasts([
  { vocabularyItemId: 'chopsticks', reading: 'はし', position: 1 },
  { vocabularyItemId: 'bridge', reading: 'はし', position: 0 },
])[0]!;

describe('contrastPairKey', () => {
  it('is order-independent', () => {
    expect(contrastPairKey({ a: contrast.a, b: contrast.b })).toBe(
      contrastPairKey({ a: contrast.b, b: contrast.a }),
    );
  });
});

describe('trialKey', () => {
  it('distinguishes the same-book and cross-book variant of one contrast', () => {
    const a: MinimalPairOccurrence = { ...contrast.a, bookId: 'book-a' };
    const b: MinimalPairOccurrence = { ...contrast.b, bookId: 'book-a' };
    expect(trialKey({ a, b, sameBook: true })).not.toBe(trialKey({ a, b, sameBook: false }));
  });
});

describe('buildHomophoneHistory / contrastStats', () => {
  const round = (timestamp: string, correct: boolean): GameRound => ({
    id: timestamp,
    timestamp,
    gameId: 'homophone-hunt',
    signal: 'any',
    poolSize: 1,
    items: [
      {
        ref: 't',
        correct,
        cluesUsed: 0,
        wrongGuesses: correct ? 0 : 1,
        points: correct ? 1 : 0,
        ms: 1,
        parts: [{ key: contrastPairKey(contrast), correct }],
      },
    ],
  });

  it('tallies per pair over the newest rounds', () => {
    const rounds = [round('2026-09-01', false), round('2026-09-02', true), round('2026-09-03', true)];
    expect(buildHomophoneHistory(rounds).get(contrastPairKey(contrast))).toEqual({
      attempts: 3,
      misses: 1,
    });
    expect(buildHomophoneHistory(rounds, 2).get(contrastPairKey(contrast))).toEqual({
      attempts: 2,
      misses: 0,
    });
  });

  it('maps a pair onto picker stats, unattempted vs. attempted', () => {
    expect(contrastStats(contrast, new Map())).toMatchObject({ hasCard: false, retrievability: null });
    const history = new Map([[contrastPairKey(contrast), { attempts: 4, misses: 1 }]]);
    expect(contrastStats(contrast, history)).toEqual({
      hasCard: true,
      lapses: 1,
      retrievability: 0.75,
      matureCards: true,
    });
  });
});

describe('buildHomophoneCandidates', () => {
  it('carries each contrast alongside its picker stats', () => {
    const history = new Map([[contrastPairKey(contrast), { attempts: 2, misses: 2 }]]);
    const candidates = buildHomophoneCandidates([contrast], history);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.id).toBe(contrastPairKey(contrast));
    expect(candidates[0]!.stats.lapses).toBe(2);
  });
});

describe('describeHomophonePick', () => {
  it('names the miss count for a weak pick with history', () => {
    const history = new Map([[contrastPairKey(contrast), { attempts: 3, misses: 2 }]]);
    expect(describeHomophonePick('weak', contrast, history)).toContain('2 misses');
  });

  it('falls back to the plain "true homophone" line otherwise', () => {
    expect(describeHomophonePick('strong', contrast, new Map())).toContain('reliably');
    expect(describeHomophonePick('any', contrast, new Map())).toContain('はし');
  });
});

interface TestClip extends MinimalPairOccurrence {
  id: string;
}

function clip(vocabularyItemId: string, reading: string, position: number, bookId: string, id: string): TestClip {
  return { vocabularyItemId, reading, position, bookId, id };
}

describe('buildHomophoneRound', () => {
  it('fills a round from the ordered contrasts, same-book then cross-book', () => {
    const clips: TestClip[] = [
      clip('chopsticks', 'はし', 1, 'book-a', 'occ-1'),
      clip('bridge', 'はし', 0, 'book-a', 'occ-2'),
      clip('bridge', 'はし', 0, 'book-b', 'occ-3'),
    ];
    const trials = buildHomophoneRound(clips, [contrast]);
    expect(trials).toHaveLength(2);
    expect(trials.map((t) => t.sameBook).sort()).toEqual([false, true]);
  });
});
