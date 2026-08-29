import { describe, expect, it } from 'vitest';

import { isReadingAnswerCorrect, surfaceReadingFromInline } from '../src/lib/readingAnswer';

describe('isReadingAnswerCorrect', () => {
  it('matches a single expected reading, kana-form lenient', () => {
    expect(isReadingAnswerCorrect('がんばる', 'がんばる')).toBe(true);
    expect(isReadingAnswerCorrect('ガンバル', 'がんばる')).toBe(true);
    expect(isReadingAnswerCorrect('ganbaru', 'がんばる')).toBe(true);
    expect(isReadingAnswerCorrect('がんばって', 'がんばる')).toBe(false);
  });

  it('accepts any of several expected readings', () => {
    expect(isReadingAnswerCorrect('がんばって', ['がんばる', 'がんばって'])).toBe(true);
    expect(isReadingAnswerCorrect('がんばる', ['がんばる', 'がんばって'])).toBe(true);
    expect(isReadingAnswerCorrect('がんばれ', ['がんばる', 'がんばって'])).toBe(false);
  });

  it('ignores blank candidates', () => {
    expect(isReadingAnswerCorrect('', ['', 'がんばる'])).toBe(false);
  });
});

describe('surfaceReadingFromInline', () => {
  it('reads an inflected form spanning a ruby group and its okurigana', () => {
    expect(
      surfaceReadingFromInline('頑張[がんば]って 速[はや]く 飛[と]ぶのよ', '頑張って'),
    ).toBe('がんばって');
  });

  it('reads a bare-kana inflected tail after a ruby stem', () => {
    expect(surfaceReadingFromInline('付[つ]いて 来[き]て', '付いて')).toBe('ついて');
  });

  it('handles a fully kanji surface form', () => {
    expect(surfaceReadingFromInline('夫婦[ふうふ]が', '夫婦')).toBe('ふうふ');
  });

  it('returns null when the surface form is not present', () => {
    expect(surfaceReadingFromInline('頑張[がんば]って', '速く')).toBeNull();
  });

  it('returns null when the match would split a ruby group', () => {
    // "頑" alone can't be sliced out of the 頑張[がんば] furigana cluster.
    expect(surfaceReadingFromInline('頑張[がんば]って', '頑張')).toBe('がんば');
    expect(surfaceReadingFromInline('頑張[がんば]って', '頑')).toBeNull();
  });

  it('returns null without an inline reading', () => {
    expect(surfaceReadingFromInline(undefined, '頑張って')).toBeNull();
    expect(surfaceReadingFromInline('', '頑張って')).toBeNull();
  });
});
