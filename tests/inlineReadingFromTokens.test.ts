import { describe, expect, it } from 'vitest';

import { inlineReadingFromTokens } from '../src/lib/inlineReadingFromTokens';
import type { MorphologyToken } from '../src/lib/vocabularySuggestions';

const tok = (
  surface: string,
  start: number,
  reading?: string,
): MorphologyToken => ({
  surface,
  start,
  end: start + surface.length,
  lemma: surface,
  reading,
});

describe('inlineReadingFromTokens', () => {
  it('annotates only kanji-bearing tokens and passes kana through', () => {
    const jp = '映画を見た';
    const tokens = [
      tok('映画', 0, 'えいが'),
      tok('を', 2, 'を'),
      tok('見', 3, 'み'),
      tok('た', 4, 'た'),
    ];
    expect(inlineReadingFromTokens(jp, tokens)).toBe('映画[えいが]を見[み]た');
  });

  it('reproduces punctuation and spacing the tokenizer skipped', () => {
    const jp = 'さすがです。 水希。';
    const tokens = [
      tok('さすが', 0, 'さすが'),
      tok('です', 3, 'です'),
      // 。 at 5 and the space at 6 are not tokens
      tok('水希', 7, 'みずき'),
    ];
    expect(inlineReadingFromTokens(jp, tokens)).toBe('さすがです。 水希[みずき]。');
  });

  it('returns empty string when nothing needs ruby', () => {
    const jp = 'たったのいっかげつ';
    expect(inlineReadingFromTokens(jp, [tok('たったの', 0), tok('いっかげつ', 4)])).toBe('');
  });

  it('returns empty string for no tokens', () => {
    expect(inlineReadingFromTokens('映画', [])).toBe('');
  });

  it('skips tokens whose span does not match the source text', () => {
    const jp = '見た';
    // stale offset from a pre-edit sentence
    expect(inlineReadingFromTokens(jp, [tok('映画', 0, 'えいが')])).toBe('');
  });

  it('fuses a digit and its counter into one ruby span', () => {
    expect(inlineReadingFromTokens('1ヶ月', [tok('1', 0), tok('ヶ月', 1, 'かげつ')])).toBe(
      '1ヶ月[いっかげつ]',
    );
    expect(
      inlineReadingFromTokens('2人で', [tok('2', 0), tok('人', 1, 'にん'), tok('で', 2, 'で')]),
    ).toBe('2人[ふたり]で');
    expect(
      inlineReadingFromTokens('20歳です', [
        tok('20', 0),
        tok('歳', 2, 'さい'),
        tok('です', 3, 'です'),
      ]),
    ).toBe('20歳[はたち]です');
  });

  it('reads a bare numeral so it survives mora segmentation', () => {
    expect(inlineReadingFromTokens('22歳', [tok('22', 0), tok('歳', 2, 'さい')])).toBe(
      '22歳[にじゅうにさい]',
    );
    // "1つ" and "下" are separate words — not one number+counter span.
    expect(
      inlineReadingFromTokens('1つ下', [tok('1', 0), tok('つ', 1, 'つ'), tok('下', 2, 'した')]),
    ).toBe('1つ[ひとつ]下[した]');
  });
});
