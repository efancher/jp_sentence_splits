import { describe, expect, it } from 'vitest';

import type { PhoneAlignment, WordAlignment } from '../src/domain/types';
import {
  isolatedWordMatchRange,
  isolatedWordRange,
  isolatedWordSpans,
  SQUASHED_MS_PER_MORA,
  wordTimingUnreliable,
} from '../src/lib/isolatedWordRange';
import { estimateWordSpans, labelReason, pickLabelQueue } from '../src/lib/wordBoundaryLabels';

/** A token of `morae` CV morae ("k a" pairs) spread evenly over [startMs, endMs]. */
function token(text: string, startMs: number, endMs: number, morae: number): WordAlignment {
  const per = (endMs - startMs) / (morae * 2);
  const phones: PhoneAlignment[] = [];
  for (let i = 0; i < morae * 2; i += 1) {
    phones.push({ text: i % 2 === 0 ? 'k' : 'a', start: (startMs + i * per) / 1000, end: (startMs + (i + 1) * per) / 1000 });
  }
  return { text, start: startMs / 1000, end: endMs / 1000, phones };
}
const eps = (startMs: number, endMs: number): WordAlignment => ({ text: '<eps>', start: startMs / 1000, end: endMs / 1000, phones: [] });

// "またVIPメンバーになると…" — real shape (sent_3756d728): the Latin VIP and メンバー are
// crushed to ~30 ms/mora and the words after them land ~1.6 s early.
const VIP_SENTENCE = 'またVIPメンバーになると私とセッション';
const vip = [
  eps(0, 120),
  token('また', 120, 540, 2), // 210 ms/mora — fine
  eps(540, 1180),
  token('vip', 1180, 1270, 3), // 30 ms/mora — squashed
  token('メンバー', 1270, 1400, 4), // 32 ms/mora — squashed
  token('に', 1400, 1590, 1),
  token('なる', 1590, 1860, 2), // 135 ms/mora, but two tokens from メンバー
  token('と', 1860, 1930, 1),
  token('私', 2020, 3520, 1), // absorbed the time the words above lost
  token('と', 3520, 3870, 1),
  token('セッション', 8020, 8740, 4), // far away — the aligner has recovered
];

describe('squashed-alignment guard', () => {
  it('treats 45 ms per mora as the line, and only for words of two or more morae', () => {
    expect(SQUASHED_MS_PER_MORA).toBe(45);
    const words = [token('たかい', 0, 150, 3), token('もの', 150, 500, 2)]; // 50 ms/mora, then fine
    expect(wordTimingUnreliable(words, 'たかいもの', 'もの')).toBe(false);
    const squashed = [token('たかい', 0, 120, 3), token('もの', 120, 500, 2)]; // 40 ms/mora
    expect(wordTimingUnreliable(squashed, 'たかいもの', 'もの')).toBe(true);
    // one mora at 30 ms (です devoiced) never counts
    const one = [token('で', 0, 30, 1), token('もの', 30, 500, 2)];
    expect(wordTimingUnreliable(one, 'でもの', 'もの')).toBe(false);
  });

  it('withholds the span for a target within two tokens of a squashed one', () => {
    // なる sits two tokens after メンバー (30 ms/mora): its 1590–1860 is wrong (the human hears it at 3200–3550).
    expect(wordTimingUnreliable(vip, VIP_SENTENCE, 'なる')).toBe(true);
    expect(isolatedWordRange(vip, VIP_SENTENCE, 'なる')).toBeNull();
    expect(isolatedWordSpans(vip, VIP_SENTENCE, 'なる')).toBeNull();
    expect(isolatedWordMatchRange(vip, VIP_SENTENCE, 'なる')).toBeNull();
  });

  it('withholds the squashed word itself and its immediate neighbours', () => {
    expect(isolatedWordMatchRange(vip, VIP_SENTENCE, 'メンバー')).toBeNull();
    expect(isolatedWordMatchRange(vip, VIP_SENTENCE, 'に')).toBeNull();
  });

  it('still trusts words the aligner recovered on — the squash is local', () => {
    expect(wordTimingUnreliable(vip, VIP_SENTENCE, 'セッション')).toBe(false);
    expect(isolatedWordMatchRange(vip, VIP_SENTENCE, 'セッション')).toEqual({ startMs: 8020, endMs: 8740 });
  });

  it('is deliberately cautious right next to a squash: a word one token before it is withheld too', () => {
    // また itself is timed fine, but it is adjacent to the crushed `vip`; two tokens is the tested radius.
    expect(wordTimingUnreliable(vip, VIP_SENTENCE, 'また')).toBe(true);
  });

  it('can be asked to return the span anyway (the labelling tool)', () => {
    expect(isolatedWordMatchRange(vip, VIP_SENTENCE, 'なる', undefined, { includeUnreliable: true })).toEqual({ startMs: 1590, endMs: 1860 });
  });
});

describe('labelling tool with the guard', () => {
  const flagged = estimateWordSpans(vip, VIP_SENTENCE, undefined, 'なる');
  const fine = estimateWordSpans(vip, VIP_SENTENCE, undefined, 'セッション');

  it('still gets a starting span for a flagged item, marks it, and shows the app plays nothing', () => {
    expect(flagged.token).toEqual({ startMs: 1590, endMs: 1860 });
    expect(flagged.mora).toEqual({ startMs: 1590, endMs: 1860 });
    expect(flagged.unreliable).toBe(true);
    expect(flagged.shipped).toBeNull();
    expect(fine.unreliable).toBe(false);
    expect(fine.shipped).not.toBeNull();
  });

  it('explains it in the "why this item" chip', () => {
    expect(labelReason(flagged, 'targeted')).toMatch(/squashed speech/);
    expect(labelReason(flagged, 'random')).toMatch(/flagged unreliable/);
    expect(labelReason(fine, 'random')).toBe('Random sample');
  });

  it('puts flagged items first in the needs-review queue so the guard gets checked', () => {
    const mk = (linkId: string, estimates: typeof flagged) => ({ linkId, bookId: 'b', estimates });
    const picked = pickLabelQueue(
      [
        mk('disagree', { token: { startMs: 0, endMs: 900 }, mora: { startMs: 0, endMs: 300 }, shipped: null }),
        mk('flagged', flagged),
      ],
      'targeted',
      5,
    );
    expect(picked.map((c) => c.linkId)).toEqual(['flagged', 'disagree']);
  });
});
