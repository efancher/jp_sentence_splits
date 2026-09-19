import { describe, expect, it } from 'vitest';

import type { GameRound } from '../src/domain/types';
import {
  buildContrastCandidates,
  buildOddEarHistory,
  buildOddEarTrial,
  contrastStats,
  cropPitchPayload,
  findContrasts,
  inWordShape,
  isPlausibleClipSpan,
  oddEarPointsAvailable,
  shapeLabel,
  type OddEarClip,
} from '../src/lib/oddEarOut';

let n = 0;
function clip(overrides: Partial<OddEarClip> & { shape: string }): OddEarClip {
  n += 1;
  return {
    vocabularyItemId: `vi-${n}`,
    expression: `語${n}`,
    reading: `かな${n}`,
    meaning: 'm',
    position: 0,
    moraCount: 3,
    bookId: 'b1',
    span: { startMs: 100, endMs: 600 },
    ...overrides,
  };
}

/** `count` distinct-reading clips of a shape. */
function many(count: number, shape: string, bookId = 'b1', moraCount = 3): OddEarClip[] {
  return Array.from({ length: count }, () => clip({ shape, bookId, moraCount }));
}

describe('inWordShape / shapeLabel', () => {
  it('gives the in-word h/l shape; heiban and odaka collapse to one', () => {
    expect(inWordShape('はし', 1)).toEqual({ moraCount: 2, shape: 'hl' }); // atamadaka
    expect(inWordShape('はし', 0)).toEqual({ moraCount: 2, shape: 'lh' }); // heiban
    expect(inWordShape('はし', 2)).toEqual({ moraCount: 2, shape: 'lh' }); // odaka — identical in-word
    expect(inWordShape('さくら', 0)!.shape).toBe('lhh');
    expect(inWordShape('あ', 0)).toBeNull(); // one mora: no contrast
  });

  it('describes shapes in plain language', () => {
    expect(shapeLabel('hll')).toMatch(/atamadaka/);
    expect(shapeLabel('lhh')).toMatch(/heiban \/ odaka/);
    expect(shapeLabel('lhl')).toMatch(/drops after mora 2 \(nakadaka\)/);
    expect(shapeLabel('lhhl')).toMatch(/after mora 3/);
  });

  it('bounds an isolated clip length', () => {
    expect(isPlausibleClipSpan({ startMs: 0, endMs: 50 })).toBe(false);
    expect(isPlausibleClipSpan({ startMs: 0, endMs: 500 })).toBe(true);
    expect(isPlausibleClipSpan({ startMs: 0, endMs: 9000 })).toBe(false);
  });
});

describe('findContrasts', () => {
  it('needs 3 distinct readings in the majority shape and only same-length words', () => {
    const clips = [...many(3, 'lhh'), ...many(1, 'hll'), ...many(4, 'hl', 'b1', 2)];
    const ids = findContrasts(clips).map((c) => c.id);
    expect(ids).toEqual(['3:lhh>hll']); // hll has 1 word (can't be a majority); 2-mora shapes are a separate length
  });

  it('does not count two words with the same reading twice', () => {
    const dupes = [
      clip({ shape: 'lhh', reading: 'あああ' }),
      clip({ shape: 'lhh', reading: 'あああ' }),
      clip({ shape: 'lhh', reading: 'いいい' }),
      ...many(1, 'hll'),
    ];
    expect(findContrasts(dupes)).toEqual([]);
  });

  it('is symmetric when both shapes can be the majority, sharing one pairKey', () => {
    const contrasts = findContrasts([...many(3, 'lhh'), ...many(3, 'hll')]);
    expect(contrasts.map((c) => c.id).sort()).toEqual(['3:hll>lhh', '3:lhh>hll']);
    expect(new Set(contrasts.map((c) => c.pairKey)).size).toBe(1);
  });
});

describe('buildOddEarTrial', () => {
  const contrast = { id: '3:lhh>hll', moraCount: 3, majorityShape: 'lhh', oddShape: 'hll', pairKey: '3m hll/lhh' };

  it('builds three alike plus one odd, distinct words and readings, odd index correct', () => {
    const clips = [...many(5, 'lhh'), ...many(2, 'hll')];
    const trial = buildOddEarTrial(clips, contrast, 'seed')!;
    expect(trial.clips).toHaveLength(4);
    expect(trial.clips.filter((c) => c.shape === 'lhh')).toHaveLength(3);
    expect(trial.clips[trial.oddIndex]!.shape).toBe('hll');
    expect(new Set(trial.clips.map((c) => c.reading)).size).toBe(4);
    expect(new Set(trial.clips.map((c) => c.vocabularyItemId)).size).toBe(4);
  });

  it('is deterministic per seed and varies across seeds', () => {
    const clips = [...many(9, 'lhh'), ...many(4, 'hll')];
    const order = (seed: string) =>
      buildOddEarTrial(clips, contrast, seed)!.clips.map((c) => c.vocabularyItemId).join();
    expect(order('a')).toBe(order('a'));
    expect(new Set(['a', 'b', 'c', 'd', 'e'].map(order)).size).toBeGreaterThan(1);
  });

  it('prefers a single-book round (same-speaker proxy) when a book can supply all four', () => {
    const clips = [
      ...many(3, 'lhh', 'bookA'),
      ...many(1, 'hll', 'bookA'),
      ...many(3, 'lhh', 'bookB'),
      ...many(2, 'hll', 'bookB'),
    ];
    for (const seed of ['a', 'b', 'c', 'd']) {
      const trial = buildOddEarTrial(clips, contrast, seed)!;
      expect(trial.sameBook).toBe(true);
      expect(new Set(trial.clips.map((c) => c.bookId)).size).toBe(1);
    }
  });

  it('falls back to a mixed-book round when no single book has enough', () => {
    const clips = [...many(2, 'lhh', 'bookA'), ...many(2, 'lhh', 'bookB'), ...many(1, 'hll', 'bookA')];
    const trial = buildOddEarTrial(clips, contrast, 'x')!;
    expect(trial.sameBook).toBe(false);
    expect(trial.clips).toHaveLength(4);
  });

  it('never puts an odd clip that sounds identical (same reading) next to the majority', () => {
    const clips = [
      clip({ shape: 'lhh', reading: 'あああ' }),
      clip({ shape: 'lhh', reading: 'いいい' }),
      clip({ shape: 'lhh', reading: 'ううう' }),
      clip({ shape: 'hll', reading: 'あああ' }), // same reading as a majority clip
    ];
    expect(buildOddEarTrial(clips, contrast, 's')).toBeNull();
  });

  it('returns null when a group is too small', () => {
    expect(buildOddEarTrial([...many(2, 'lhh'), ...many(1, 'hll')], contrast, 's')).toBeNull();
  });
});

describe('scoring and history', () => {
  it('is worth 3 points, minus one per wrong tap, floor 0', () => {
    expect(oddEarPointsAvailable(0)).toBe(3);
    expect(oddEarPointsAvailable(2)).toBe(1);
    expect(oddEarPointsAvailable(7)).toBe(0);
  });

  const round = (timestamp: string, key: string, correct: boolean): GameRound => ({
    id: timestamp,
    timestamp,
    gameId: 'odd-ear-out',
    signal: 'any',
    poolSize: 5,
    items: [{ ref: 't', correct, cluesUsed: 0, wrongGuesses: correct ? 0 : 1, points: 0, ms: 1, parts: [{ key, correct }] }],
  });

  it('tallies per shape pair over the newest rounds', () => {
    const rounds = [round('2026-09-01', 'k', false), round('2026-09-02', 'k', true), round('2026-09-03', 'k', true)];
    expect(buildOddEarHistory(rounds).get('k')).toEqual({ attempts: 3, misses: 1 });
    expect(buildOddEarHistory(rounds, 2).get('k')).toEqual({ attempts: 2, misses: 0 });
  });

  it('maps a contrast onto picker stats, and builds candidates carrying them', () => {
    const contrast = { id: 'c', moraCount: 3, majorityShape: 'lhh', oddShape: 'hll', pairKey: '3m hll/lhh' };
    expect(contrastStats(contrast, new Map())).toMatchObject({ hasCard: false, retrievability: null });
    expect(contrastStats(contrast, new Map([['3m hll/lhh', { attempts: 4, misses: 1 }]]))).toEqual({
      hasCard: true,
      lapses: 1,
      retrievability: 0.75,
      matureCards: true,
    });
    const candidates = buildContrastCandidates(
      [...many(3, 'lhh'), ...many(1, 'hll')],
      new Map([['3m hll/lhh', { attempts: 2, misses: 2 }]]),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.stats.lapses).toBe(2);
  });
});

describe('cropPitchPayload', () => {
  it('keeps only frames inside the span, re-based to t=0', () => {
    const frame = (t: number) => ({ timeSeconds: t, hz: 100, relativeSemitones: 0, voiced: true }) as never;
    const cropped = cropPitchPayload(
      { frames: [frame(0.05), frame(0.2), frame(0.4), frame(0.9)], medianHz: 100, voicedRatio: 1, durationSeconds: 1 },
      { startMs: 150, endMs: 500 },
    );
    expect(cropped.frames.map((f) => f.timeSeconds)).toEqual([expect.closeTo(0.05, 5), expect.closeTo(0.25, 5)]);
    expect(cropped.durationSeconds).toBeCloseTo(0.35, 5);
  });
});
