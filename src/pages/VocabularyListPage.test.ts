import { describe, expect, it } from 'vitest';

import type { VocabularyItem } from '../domain/types';
import { matchesVocabularySearch } from './VocabularyListPage';

function makeItem(overrides: Partial<VocabularyItem> = {}): VocabularyItem {
  return {
    id: 'v1',
    expression: '猫',
    reading: 'ねこ',
    meaning: 'cat, dog lover',
    partOfSpeech: 'noun',
    ...overrides,
  } as VocabularyItem;
}

describe('matchesVocabularySearch', () => {
  it('matches romaji typed for a hiragana reading, without a Japanese IME', () => {
    expect(matchesVocabularySearch(makeItem(), 'neko')).toBe(true);
  });

  it('matches double-consonant romaji (small tsu) against the reading', () => {
    const item = makeItem({ expression: '結婚', reading: 'けっこん', meaning: 'marriage' });
    expect(matchesVocabularySearch(item, 'kekkon')).toBe(true);
  });

  it('still matches plain kanji expression queries', () => {
    expect(matchesVocabularySearch(makeItem(), '猫')).toBe(true);
  });

  it('still matches plain hiragana reading queries', () => {
    expect(matchesVocabularySearch(makeItem(), 'ねこ')).toBe(true);
  });

  it('still matches English meaning queries, without romaji conversion corrupting them', () => {
    expect(matchesVocabularySearch(makeItem(), 'dog')).toBe(true);
  });

  it('does not match unrelated queries', () => {
    expect(matchesVocabularySearch(makeItem(), 'inu')).toBe(false);
    expect(matchesVocabularySearch(makeItem(), 'fish')).toBe(false);
  });

  it('does not let a partial/ambiguous romaji buffer produce a false match', () => {
    // "nek" alone doesn't fully convert to kana (trailing consonant needs a vowel),
    // so mid-typing it must not match a real hiragana reading like "ねこ".
    expect(matchesVocabularySearch(makeItem({ reading: 'ねこ' }), 'nek')).toBe(false);
  });
});
