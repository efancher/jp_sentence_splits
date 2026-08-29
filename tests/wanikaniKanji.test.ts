import { describe, expect, it } from 'vitest';

import {
  isHiddenSubject,
  primaryMeanings,
  readingsByType,
  wanikaniSubjectToKanjiFields,
  type WkKanjiSubject,
} from '../scripts/lib/wanikani';

function subject(overrides: Partial<WkKanjiSubject['data']> = {}, id = 42): WkKanjiSubject {
  return {
    id,
    object: 'kanji',
    data: {
      characters: '生',
      hidden_at: null,
      meanings: [
        { meaning: 'Life', primary: true },
        { meaning: 'Birth', primary: false },
      ],
      readings: [
        { reading: 'セイ', type: 'onyomi', primary: true },
        { reading: 'ショウ', type: 'onyomi', primary: false },
        { reading: 'い.きる', type: 'kunyomi', primary: true },
        { reading: 'なま', type: 'nanori', primary: false, accepted_answer: true },
      ],
      ...overrides,
    },
  };
}

describe('isHiddenSubject', () => {
  it('is true when hidden_at is set', () => {
    expect(isHiddenSubject(subject({ hidden_at: '2024-01-01T00:00:00Z' }))).toBe(true);
  });

  it('is false when hidden_at is null', () => {
    expect(isHiddenSubject(subject())).toBe(false);
  });
});

describe('primaryMeanings', () => {
  it('returns only primary/accepted meanings when any are flagged', () => {
    expect(primaryMeanings(subject())).toEqual(['Life']);
  });

  it('falls back to all meanings when none are flagged', () => {
    const s = subject({ meanings: [{ meaning: 'Life' }, { meaning: 'Birth' }] });
    expect(primaryMeanings(s)).toEqual(['Life', 'Birth']);
  });
});

describe('readingsByType', () => {
  it('groups primary/accepted readings by type', () => {
    expect(readingsByType(subject())).toEqual({
      onyomi: ['セイ'],
      kunyomi: ['い.きる'],
      nanori: ['なま'],
    });
  });

  it('falls back to all readings of a type when none are flagged primary', () => {
    const s = subject({
      readings: [
        { reading: 'セイ', type: 'onyomi' },
        { reading: 'ショウ', type: 'onyomi' },
      ],
    });
    expect(readingsByType(s)).toEqual({ onyomi: ['セイ', 'ショウ'], kunyomi: [], nanori: [] });
  });

  it('decides the primary-vs-all fallback per type, not globally', () => {
    // kunyomi has a primary reading; onyomi does not. Both of onyomi's
    // readings must still come through, not be dropped because a *different*
    // type happened to have a primary flag somewhere.
    const s = subject({
      readings: [
        { reading: 'ショク', type: 'onyomi', primary: false },
        { reading: 'ジキ', type: 'onyomi', primary: false },
        { reading: 'た.べる', type: 'kunyomi', primary: true },
      ],
    });
    expect(readingsByType(s)).toEqual({
      onyomi: ['ショク', 'ジキ'],
      kunyomi: ['た.べる'],
      nanori: [],
    });
  });
});

describe('wanikaniSubjectToKanjiFields', () => {
  it('transforms a subject into Kanji fields, mnemonics null when absent', () => {
    expect(wanikaniSubjectToKanjiFields(subject({}, 42))).toEqual({
      character: '生',
      meanings: ['Life'],
      onyomi: ['セイ'],
      kunyomi: ['い.きる'],
      nanori: ['なま'],
      meaningMnemonic: null,
      meaningHint: null,
      readingMnemonic: null,
      readingHint: null,
      externalId: 'wk:42',
    });
  });

  it('carries the WaniKani mnemonics and hints (trimmed) when present', () => {
    const fields = wanikaniSubjectToKanjiFields(
      subject({
        meaning_mnemonic: '  A <radical>life</radical> begins.  ',
        meaning_hint: 'Remember the sprout.',
        reading_mnemonic: 'The reading is <reading>セイ</reading>.',
        reading_hint: '',
      }),
    );
    expect(fields).toMatchObject({
      meaningMnemonic: 'A <radical>life</radical> begins.',
      meaningHint: 'Remember the sprout.',
      readingMnemonic: 'The reading is <reading>セイ</reading>.',
      readingHint: null,
    });
  });

  it('returns null when the subject has no character', () => {
    expect(wanikaniSubjectToKanjiFields(subject({ characters: null }))).toBeNull();
  });
});
