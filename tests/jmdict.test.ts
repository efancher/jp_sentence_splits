import { describe, expect, it } from 'vitest';

import {
  buildJmdictIndex,
  glossEntriesFromJmdictEntry,
  lookupJmdict,
  type JmdictEntry,
  type JmdictFile,
} from '../scripts/lib/jmdict';

describe('glossEntriesFromJmdictEntry', () => {
  it('crosses kanji and kana respecting appliesToKanji restrictions', () => {
    const entry: JmdictEntry = {
      id: '1',
      kanji: [{ text: '生', common: true }],
      kana: [
        { text: 'せい', appliesToKanji: ['生'] },
        { text: 'なま', appliesToKanji: ['*'] },
        { text: 'よみ', appliesToKanji: ['読'] },
      ],
      sense: [{ partOfSpeech: ['n'], gloss: [{ lang: 'eng', text: 'life' }] }],
    };
    const result = glossEntriesFromJmdictEntry(entry);
    expect(result.map((r) => r.reading)).toEqual(['せい', 'なま']);
    expect(result[0]).toMatchObject({ expression: '生', gloss: 'life', pos: 'n', common: true });
  });

  it('falls back to kana-only entries when there is no kanji', () => {
    const entry: JmdictEntry = {
      id: '2',
      kana: [{ text: 'ありがとう', common: true }],
      sense: [{ gloss: [{ lang: 'eng', text: 'thank you' }] }],
    };
    const result = glossEntriesFromJmdictEntry(entry);
    expect(result).toEqual([
      { expression: 'ありがとう', reading: 'ありがとう', gloss: 'thank you', pos: '', common: true, entryId: '2' },
    ]);
  });

  it('returns nothing when there is no English gloss', () => {
    const entry: JmdictEntry = {
      id: '3',
      kana: [{ text: 'てすと' }],
      sense: [{ gloss: [{ lang: 'fre', text: 'essai' }] }],
    };
    expect(glossEntriesFromJmdictEntry(entry)).toEqual([]);
  });

  it('dedups partOfSpeech tags across senses', () => {
    const entry: JmdictEntry = {
      id: '4',
      kana: [{ text: 'たべる' }],
      sense: [
        { partOfSpeech: ['v1', 'vt'], gloss: [{ lang: 'eng', text: 'to eat' }] },
        { partOfSpeech: ['v1'], gloss: [{ lang: 'eng', text: 'to live on' }] },
      ],
    };
    expect(glossEntriesFromJmdictEntry(entry)[0].pos).toBe('v1,vt');
  });
});

describe('buildJmdictIndex / lookupJmdict', () => {
  const file: JmdictFile = {
    words: [
      {
        id: 'shukan-1',
        kanji: [{ text: '週間', common: true }],
        kana: [{ text: 'しゅうかん', appliesToKanji: ['*'] }],
        sense: [{ gloss: [{ lang: 'eng', text: 'week' }] }],
      },
      {
        id: 'shukan-2',
        kanji: [{ text: '習慣' }],
        kana: [{ text: 'しゅうかん', appliesToKanji: ['*'] }],
        sense: [{ gloss: [{ lang: 'eng', text: 'habit' }] }],
      },
      {
        id: 'sensei-1',
        kanji: [{ text: '先生', common: true }],
        kana: [{ text: 'せんせい', appliesToKanji: ['*'] }],
        sense: [{ gloss: [{ lang: 'eng', text: 'teacher' }] }],
      },
    ],
  };
  const index = buildJmdictIndex(file);

  it('keeps homophones distinct by expression+reading, not merged', () => {
    expect(lookupJmdict(index, '週間', 'しゅうかん')?.gloss).toBe('week');
    expect(lookupJmdict(index, '習慣', 'しゅうかん')?.gloss).toBe('habit');
  });

  it('falls back to the best (common-first) candidate when reading is omitted', () => {
    expect(lookupJmdict(index, '先生')?.gloss).toBe('teacher');
  });

  it('returns null for unknown expressions', () => {
    expect(lookupJmdict(index, '存在しない単語')).toBeNull();
  });
});
