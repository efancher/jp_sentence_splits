import { describe, expect, it } from 'vitest';

import type { WordAlignment, WordBoundaryLabel } from '../src/domain/types';
import {
  edgeErrors,
  edgesMoved,
  estimateWordSpans,
  estimatorDisagreementMs,
  labelReason,
  percentile,
  pickLabelQueue,
  startingSpan,
  summarizeErrors,
} from '../src/lib/wordBoundaryLabels';

const phones = (spec: string, startMs: number) => {
  let t = startMs;
  return spec.split(' ').map((item) => {
    const [, text, ms] = /^(.+)\((\d+)\)$/.exec(item)!;
    const start = t / 1000;
    t += Number(ms);
    return { text: text!, start, end: t / 1000 };
  });
};
const token = (text: string, startMs: number, spec: string): WordAlignment => {
  const ph = phones(spec, startMs);
  return { text, start: ph[0]!.start, end: ph[ph.length - 1]!.end, phones: ph };
};

describe('estimateWordSpans', () => {
  // 生まれた — the target 生まれ ends inside the token, so token and mora differ.
  const words = [token('生まれた', 1000, 'ɯ(100) m(100) a(100) ɾ(40) e(80) t(90) a(100)')];
  const est = estimateWordSpans(words, '生まれた', '生まれ[うまれ]た', '生まれ');

  it('gives the whole token, the mora cut, and the padded span the app plays', () => {
    expect(est.token).toEqual({ startMs: 1000, endMs: 1610 });
    expect(est.mora).toEqual({ startMs: 1000, endMs: 1420 });
    // shipped = mora + pad: nothing before → 30 ms onset; rest of the token is butted → no tail pad.
    expect(est.shipped).toEqual({ startMs: 970, endMs: 1420 });
  });

  it('starts the handles at the mora cut, falling back to the token', () => {
    expect(startingSpan(est)).toEqual(est.mora);
    expect(startingSpan({ token: est.token, mora: null, shipped: null })).toEqual(est.token);
    expect(startingSpan({ token: null, mora: null, shipped: null })).toBeNull();
  });

  it('measures how far the estimators disagree', () => {
    expect(estimatorDisagreementMs(est)).toBe(190);
    expect(estimatorDisagreementMs({ token: est.token, mora: est.token, shipped: null })).toBe(0);
    expect(estimatorDisagreementMs({ token: est.token, mora: null, shipped: null })).toBe(0);
  });

  it('explains why an item was picked', () => {
    expect(labelReason(est, 'random')).toBe('Random sample');
    expect(labelReason(est, 'targeted')).toBe('Token vs mora cut differ by 190 ms');
    const short = { ...est, mora: { startMs: 0, endMs: 120 } };
    expect(labelReason(short, 'targeted')).toBe('Very short mora cut (120 ms)');
  });
});

/** Deterministic PRNG so queue tests are repeatable. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const span = (startMs: number, endMs: number) => ({ startMs, endMs });
const cand = (linkId: string, bookId: string | undefined, token: [number, number], mora: [number, number]) => ({
  linkId,
  bookId,
  estimates: { token: span(...token), mora: span(...mora), shipped: null },
});

describe('pickLabelQueue', () => {
  it('random: spreads across books round-robin so a big book cannot crowd out a small one', () => {
    const candidates = [
      ...Array.from({ length: 30 }, (_, i) => cand(`big${i}`, 'big', [0, 500], [0, 500])),
      ...Array.from({ length: 3 }, (_, i) => cand(`small${i}`, 'small', [0, 500], [0, 500])),
    ];
    const picked = pickLabelQueue(candidates, 'random', 6, seeded(1));
    expect(picked).toHaveLength(6);
    expect(picked.filter((c) => c.bookId === 'small')).toHaveLength(3);
    expect(picked.filter((c) => c.bookId === 'big')).toHaveLength(3);
    expect(new Set(picked.map((c) => c.linkId)).size).toBe(6);
  });

  it('random: returns fewer than asked when the pool is small, and skips items with no span', () => {
    const none = { linkId: 'x', bookId: 'b', estimates: { token: null, mora: null, shipped: null } };
    const picked = pickLabelQueue([cand('a', 'b', [0, 1], [0, 1]), none], 'random', 5, seeded(2));
    expect(picked.map((c) => c.linkId)).toEqual(['a']);
  });

  it('targeted: only disagreements, biggest first, short mora cuts boosted', () => {
    const picked = pickLabelQueue(
      [
        cand('agree', 'b', [0, 800], [0, 800]),
        cand('small', 'b', [0, 800], [0, 760]), // 40 ms
        cand('big', 'b', [0, 800], [0, 400]), // 400 ms
        cand('shortmora', 'b', [0, 300], [0, 150]), // 150 ms diff + short-mora boost
      ],
      'targeted',
      10,
    );
    expect(picked.map((c) => c.linkId)).toEqual(['big', 'shortmora', 'small']);
  });
});

const label = (over: Partial<WordBoundaryLabel>): WordBoundaryLabel => ({
  id: 'l',
  sentenceVocabularyId: 'v',
  sentenceId: 's',
  sentenceAudioId: 'a',
  surfaceForm: '語',
  verdict: 'corrected',
  shown: span(1000, 1400),
  label: span(1030, 1380),
  estimates: { token: span(1000, 1700), mora: span(1000, 1400), shipped: span(970, 1440) },
  sampleKind: 'random',
  spanVersion: 'v',
  elapsedMs: 1,
  createdAt: '2026-09-20T00:00:00Z',
  ...over,
});

describe('edge errors', () => {
  const labels = [
    label({}),
    label({ id: 'clean', verdict: 'clean', label: span(1000, 1400) }),
    label({ id: 'skip', verdict: 'skipped', label: undefined }),
    label({ id: 'targeted', sampleKind: 'targeted', label: span(1000, 1500) }),
  ];

  it('is estimator minus label, per edge, ignoring skipped items', () => {
    expect(edgeErrors(labels, 'mora')).toEqual({ start: [-30, 0, 0], end: [20, 0, -100] });
    expect(edgeErrors(labels, 'token').end).toEqual([320, 300, 200]);
  });

  it('can be restricted, e.g. to the unbiased random sample', () => {
    expect(edgeErrors(labels, 'mora', (l) => l.sampleKind === 'random').end).toEqual([20, 0]);
  });

  it('a clean label equals what was shown, so the shown span has zero error', () => {
    expect(edgeErrors([labels[1]!], 'shown')).toEqual({ start: [0], end: [0] });
  });
});

describe('statistics', () => {
  it('interpolates percentiles and handles empty input', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([5], 0.9)).toBe(5);
    expect(percentile([], 0.5)).toBeNaN();
  });

  it('summarizes signed bias and the share within 25/50 ms', () => {
    const s = summarizeErrors([-10, 20, -60, 40]);
    expect(s.n).toBe(4);
    expect(s.medianMs).toBe(5);
    expect(s.medianAbsMs).toBe(30);
    expect(s.within25).toBe(0.5);
    expect(s.within50).toBe(0.75);
    expect(summarizeErrors([]).within50).toBeNaN();
  });

  it('detects moved edges beyond rounding', () => {
    expect(edgesMoved(span(1000, 1400), span(1000, 1400))).toBe(false);
    expect(edgesMoved(span(1000, 1400), span(1000.4, 1400))).toBe(false);
    expect(edgesMoved(span(1000, 1400), span(1001, 1400))).toBe(true);
  });
});
