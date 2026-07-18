import { describe, expect, it } from 'vitest';

import { parseInlineReadings } from '../src/lib/parseInlineReadings';

describe('parseInlineReadings', () => {
  it('parses simple kanji readings', () => {
    expect(parseInlineReadings('小鳥[ことり]')).toEqual([
      { kind: 'ruby', base: '小鳥', reading: 'ことり' },
    ]);
  });

  it('parses mixed punctuation and spaces', () => {
    const segments = parseInlineReadings(
      'ある 小鳥[ことり]の 夫婦[ふうふ]が、 木[き]に 巣[す]を 作[つく]りました。',
    );
    expect(segments.some((item) => item.kind === 'ruby' && item.base === '小鳥')).toBe(
      true,
    );
    expect(segments.some((item) => item.kind === 'text' && item.base.includes('ある'))).toBe(
      true,
    );
  });

  it('falls back to plain text when brackets are unmatched', () => {
    expect(parseInlineReadings('小鳥[ことり')).toEqual([
      { kind: 'text', base: '小鳥[ことり' },
    ]);
  });

  it('supports okurigana-style stems', () => {
    const segments = parseInlineReadings('作[つく]りました');
    expect(segments[0]).toEqual({ kind: 'ruby', base: '作', reading: 'つく' });
    expect(segments.some((item) => item.base.includes('りました'))).toBe(true);
  });
});
