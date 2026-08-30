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

  it('keeps interior and trailing okurigana in a whole-word base', () => {
    // inlineReadingFromTokens (mining / re-segmentation) annotates the whole
    // written word, not just its kanji core.
    expect(parseInlineReadings('同い年[おないどし]')).toEqual([
      { kind: 'ruby', base: '同い年', reading: 'おないどし' },
    ]);
    expect(parseInlineReadings('焼き鳥[やきとり]')).toEqual([
      { kind: 'ruby', base: '焼き鳥', reading: 'やきとり' },
    ]);
    expect(parseInlineReadings('歩い[あるい]て')).toEqual([
      { kind: 'ruby', base: '歩い', reading: 'あるい' },
      { kind: 'text', base: 'て' },
    ]);
  });

  it('splits a leading particle run off a spaceless whole-word base', () => {
    expect(parseInlineReadings('に焼き鳥[やきとり]がある')).toEqual([
      { kind: 'text', base: 'に' },
      { kind: 'ruby', base: '焼き鳥', reading: 'やきとり' },
      { kind: 'text', base: 'がある' },
    ]);
  });

  it('leaves a bracketed stage direction with no kanji base as text', () => {
    const segments = parseInlineReadings('もう[音楽]です');
    expect(segments.every((item) => item.kind === 'text')).toBe(true);
    expect(segments.map((item) => item.base).join('')).toBe('もう[音楽]です');
  });

  it('does not swallow a preceding hiragana run into the next ruby base when there is no separating space', () => {
    // Real production data: "でもう1ヶ月[いっかげつ]", no space before "1ヶ月".
    const segments = parseInlineReadings(
      'あの 店[みせ]でもう1ヶ月[いっかげつ]も 働[はたら]いてるし。',
    );
    expect(segments).toContainEqual({ kind: 'text', base: 'でもう' });
    expect(segments).toContainEqual({ kind: 'ruby', base: '1ヶ月', reading: 'いっかげつ' });
  });
});
