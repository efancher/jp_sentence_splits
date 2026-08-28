import { describe, expect, it } from 'vitest';

import {
  buildJmdictIndex,
  glossEntriesFromJmdictEntry,
  japanesePosToJmdictClass,
  jmdictPosClasses,
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
    expect(result.map((r) => [r.expression, r.reading])).toEqual([
      ['生', 'せい'],
      ['生', 'なま'],
      ['せい', 'せい'],
      ['なま', 'なま'],
      ['よみ', 'よみ'],
    ]);
    expect(result[0]).toMatchObject({ expression: '生', gloss: 'life', pos: 'n', common: true });
  });

  it('also indexes kana-only self-entries for kanji-bearing words, for kana-lemma lookups', () => {
    const entry: JmdictEntry = {
      id: '5',
      kanji: [{ text: '皆', common: true }],
      kana: [{ text: 'みんな', common: true, appliesToKanji: ['*'] }],
      sense: [{ partOfSpeech: ['n'], gloss: [{ lang: 'eng', text: 'everyone' }] }],
    };
    const result = glossEntriesFromJmdictEntry(entry);
    expect(result).toEqual([
      { expression: '皆', reading: 'みんな', gloss: 'everyone', pos: 'n', posClasses: ['noun'], common: true, entryId: '5' },
      { expression: 'みんな', reading: 'みんな', gloss: 'everyone', pos: 'n', posClasses: ['noun'], common: true, entryId: '5' },
    ]);
  });

  it('falls back to kana-only entries when there is no kanji', () => {
    const entry: JmdictEntry = {
      id: '2',
      kana: [{ text: 'ありがとう', common: true }],
      sense: [{ gloss: [{ lang: 'eng', text: 'thank you' }] }],
    };
    const result = glossEntriesFromJmdictEntry(entry);
    expect(result).toEqual([
      { expression: 'ありがとう', reading: 'ありがとう', gloss: 'thank you', pos: '', posClasses: [], common: true, entryId: '2' },
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

describe('lookupJmdict POS disambiguation', () => {
  // する: "to do" (vs-i) collides with 為/簾 "bamboo screen" (n) — both common.
  const file: JmdictFile = {
    words: [
      {
        id: 'suru-verb',
        kana: [{ text: 'する', common: true }],
        sense: [{ partOfSpeech: ['vs-i'], gloss: [{ lang: 'eng', text: 'to do' }] }],
      },
      {
        id: 'su-screen',
        kanji: [{ text: '簾', common: true }],
        kana: [{ text: 'す', common: true }, { text: 'する', common: true }],
        sense: [{ partOfSpeech: ['n'], gloss: [{ lang: 'eng', text: 'bamboo screen' }] }],
      },
    ],
  };
  const index = buildJmdictIndex(file);

  it('returns null for an ambiguous homophone when no POS is given', () => {
    expect(lookupJmdict(index, 'する')).toBeNull();
  });

  it('resolves to the verb entry when the fugashi POS says 動詞', () => {
    expect(lookupJmdict(index, 'する', undefined, '動詞/非自立可能')?.gloss).toBe('to do');
  });

  it('resolves to the noun entry when the POS says 名詞', () => {
    expect(lookupJmdict(index, 'する', undefined, '名詞/普通名詞')?.gloss).toBe('bamboo screen');
  });

  it('keeps the ambiguous candidates in byExpression rather than dropping them', () => {
    expect(index.byExpression.get('する')?.length).toBe(2);
  });
});

describe('POS mapping helpers', () => {
  it('maps fugashi/UniDic major classes', () => {
    expect(japanesePosToJmdictClass('動詞/一般')).toBe('verb');
    expect(japanesePosToJmdictClass('名詞/固有名詞')).toBe('noun');
    expect(japanesePosToJmdictClass('形容詞/非自立可能')).toBe('adj-i');
    expect(japanesePosToJmdictClass('形状詞/一般')).toBe('adj-na');
    expect(japanesePosToJmdictClass('副詞')).toBe('adv');
    expect(japanesePosToJmdictClass('助詞/格助詞')).toBeNull();
  });

  it('maps JMDict tag lists to every class they imply', () => {
    expect(jmdictPosClasses('v5r,vt')).toEqual(['verb']);
    expect(jmdictPosClasses('n,vs').sort()).toEqual(['noun', 'verb']);
    expect(jmdictPosClasses('adj-i')).toEqual(['adj-i']);
    expect(jmdictPosClasses('prt,int')).toEqual([]);
  });
});
