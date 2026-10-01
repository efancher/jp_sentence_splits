import { describe, expect, it } from 'vitest';

import { newWordSegments, segmentsInRange } from '../src/lib/newWordFurigana';

const japanese = '図書館で本を読みました。';
const inline = '図書館[としょかん]で本[ほん]を読[よ]みました。';
const spans = [
  { start: 0, end: 3, expression: '図書館' },
  { start: 4, end: 5, expression: '本' },
  { start: 6, end: 7, expression: '読む' },
];

describe('newWordSegments', () => {
  it('keeps ruby for every word when none are known', () => {
    const segments = newWordSegments(japanese, inline, spans, new Set())!;
    expect(segments.filter((s) => s.kind === 'ruby').map((s) => s.base)).toEqual(['図書館', '本', '読']);
  });

  it('drops ruby only over known words', () => {
    const segments = newWordSegments(japanese, inline, spans, new Set(['本']))!;
    expect(segments.filter((s) => s.kind === 'ruby').map((s) => s.base)).toEqual(['図書館', '読']);
    expect(segments.map((s) => s.base).join('')).toBe(japanese);
  });

  it('returns null when the reading does not match the sentence', () => {
    expect(newWordSegments('別の文', inline, spans, new Set())).toBeNull();
    expect(newWordSegments(japanese, undefined, spans, new Set())).toBeNull();
  });

  it('slices segments for a token range', () => {
    const segments = newWordSegments(japanese, inline, spans, new Set())!;
    expect(segmentsInRange(segments, 4, 7).map((s) => s.base)).toEqual(['本', 'を', '読']);
    expect(segmentsInRange(segments, 3, 4).map((s) => s.base)).toEqual(['で']);
  });
});
