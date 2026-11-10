import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb, getSentencePitchAccentTargets } from '../src/db/repository';
import type { VocabularySuggestion } from '../src/domain/types';
import { createId } from '../src/lib/ids';
import {
  buildKanjiumPitchLookup,
  kanjiumTargetsForSuggestions,
} from '../src/lib/kanjiumPitchLookup';
import { resetKanjiumPitchCache } from '../src/lib/kanjiumPitchLoader';
import { suggestionFromToken } from '../src/lib/vocabularySuggestions';

const TABLE: Record<string, string> = {
  '橋|はし': '2',
  '箸|はし': '1',
  '有る|ある': '1',
  '其の|その': '0',
  '日本|にほん': '2',
  '田中|たなか': '0',
  '種|たね': '0',
  '胤|たね': '0',
  '雨|あめ': '1,0',
  '走る|はしる': '2',
  '食べる|たべる': '2',
  '為る|する': '0',
  '来る|くる': '1',
  '言う|いう': '0',
  '言う|ゆう': '0',
};

const SENTENCE = { japanese: '橋を渡る。', inlineReading: undefined };

function suggestion(over: Partial<VocabularySuggestion>): VocabularySuggestion {
  return {
    id: 's',
    surface: '',
    start: 0,
    end: 0,
    expression: '',
    reading: '',
    pos: '名詞/普通名詞',
    source: 'morphology',
    selectedByDefault: true,
    ...over,
  };
}

describe('buildKanjiumPitchLookup', () => {
  const lookup = buildKanjiumPitchLookup(TABLE);

  it('matches expression+reading exactly, with katakana readings folded', () => {
    expect(lookup.find('橋', 'はし')).toEqual([2]);
    expect(lookup.find('日本', 'ニホン')).toEqual([2]);
  });

  it('returns every listed accent, first one first', () => {
    expect(lookup.find('雨', 'あめ')).toEqual([1, 0]);
  });

  it('uses a reading-only match for kana lemmas when every entry agrees', () => {
    expect(lookup.find('その', 'その')).toEqual([0]);
    expect(lookup.find('ある', 'ある')).toEqual([1]);
    expect(lookup.find('たね', 'たね')).toEqual([0]);
  });

  it('refuses a reading-only match that is ambiguous or for a kanji expression', () => {
    expect(lookup.find('はし', 'はし')).toBeUndefined();
    expect(lookup.find('多中', 'たなか')).toBeUndefined();
    expect(lookup.find('橋本', 'はしもと')).toBeUndefined();
  });
});

describe('kanjiumTargetsForSuggestions', () => {
  const lookup = buildKanjiumPitchLookup(TABLE);

  it('marks citation-form content tokens only', () => {
    const targets = kanjiumTargetsForSuggestions(
      [
        suggestion({ surface: '橋', expression: '橋', reading: 'はし' }),
        suggestion({ surface: '有っ', expression: '有る', reading: 'ある', pos: '動詞/非自立可能' }),
        suggestion({ surface: 'を', expression: 'を', reading: 'を', selectedByDefault: false }),
      ],
      lookup,
      new Set(),
      SENTENCE,
    );
    expect(targets).toEqual([{ surfaceForm: '橋', reading: 'はし', pitchAccentPositions: [2] }]);
  });

  it('passes the alternative accents through for a word with more than one', () => {
    const targets = kanjiumTargetsForSuggestions(
      [suggestion({ surface: '雨', expression: '雨', reading: 'あめ' })],
      lookup,
      new Set(),
      SENTENCE,
    );
    expect(targets[0]?.pitchAccentPositions).toEqual([1, 0]);
  });

  it('places an inflected godan verb by inferring its word class from the surface', () => {
    const targets = kanjiumTargetsForSuggestions(
      [suggestion({ surface: '走らない', expression: '走る', reading: 'はしる', pos: '動詞/一般' })],
      lookup,
      new Set(),
      { japanese: '公園を走らない。', inlineReading: undefined },
    );
    expect(targets).toEqual([{ surfaceForm: '走らない', reading: 'はしらない', pitchAccentPositions: [3] }]);
  });

  it('places an inflected ichidan verb differently from a godan one', () => {
    const targets = kanjiumTargetsForSuggestions(
      [suggestion({ surface: '食べない', expression: '食べる', reading: 'たべる', pos: '動詞/一般' })],
      lookup,
      new Set(),
      { japanese: '魚を食べない。', inlineReading: undefined },
    );
    // 食べる[2] ichidan negative keeps the citation downstep (citation morae 3 → 2 is not unaccented).
    expect(targets).toEqual([{ surfaceForm: '食べない', reading: 'たべない', pitchAccentPositions: [2] }]);
  });

  it('recovers a light verb whose stored reading is the inflected one, via its standard headword', () => {
    const targets = kanjiumTargetsForSuggestions(
      [suggestion({ surface: 'する', expression: 'する', reading: 'し', pos: '動詞/非自立可能' })],
      lookup,
      new Set(),
      { japanese: '勉強する。', inlineReading: undefined },
    );
    expect(targets).toEqual([{ surfaceForm: 'する', reading: 'する', pitchAccentPositions: [0] }]);
  });

  it('uses the only Kanjium reading of a kanji verb stored with an inflected reading', () => {
    const targets = kanjiumTargetsForSuggestions(
      [suggestion({ surface: '来る', expression: '来る', reading: 'き', pos: '動詞/非自立可能' })],
      lookup,
      new Set(),
      { japanese: '友達が来る。', inlineReading: undefined },
    );
    expect(targets).toEqual([{ surfaceForm: '来る', reading: 'くる', pitchAccentPositions: [1] }]);
  });

  it('falls back to the UniDic accent when Kanjium has no entry, but prefers Kanjium', () => {
    const targets = kanjiumTargetsForSuggestions(
      [
        suggestion({ surface: '駅前', expression: '駅前', reading: 'えきまえ', accentType: 0 }),
        suggestion({ surface: '橋', expression: '橋', reading: 'はし', accentType: 1 }),
      ],
      lookup,
      new Set(),
      SENTENCE,
    );
    expect(targets).toEqual([
      { surfaceForm: '駅前', reading: 'えきまえ', pitchAccentPositions: [0] },
      { surfaceForm: '橋', reading: 'はし', pitchAccentPositions: [2] },
    ]);
  });

  it('leaves an inflected form unmarked when the resolver does not cover it', () => {
    const targets = kanjiumTargetsForSuggestions(
      [suggestion({ surface: '走って', expression: '走る', reading: 'はしる', pos: '動詞/一般' })],
      lookup,
      new Set(),
      { japanese: '公園を走って帰った。', inlineReading: undefined },
    );
    expect(targets).toEqual([]);
  });

  it('skips words a vocabulary link already marked', () => {
    const targets = kanjiumTargetsForSuggestions(
      [suggestion({ surface: '橋', expression: '橋', reading: 'はし' })],
      lookup,
      new Set(['橋']),
      SENTENCE,
    );
    expect(targets).toEqual([]);
  });
});

describe('suggestionFromToken accent type', () => {
  const base = { surface: '駅前', start: 0, end: 2, lemma: '駅前', reading: 'えきまえ' };
  it('keeps a plain-integer UniDic accent and drops it for proper nouns', () => {
    expect(suggestionFromToken({ ...base, pos: '名詞/普通名詞', accentType: '0' }, '駅前')?.accentType).toBe(0);
    expect(suggestionFromToken({ ...base, pos: '名詞/固有名詞', accentType: '1' }, '駅前')?.accentType).toBeUndefined();
    expect(suggestionFromToken({ ...base, pos: '名詞/普通名詞', accentType: '' }, '駅前')?.accentType).toBeUndefined();
  });
});

describe('getSentencePitchAccentTargets Kanjium fallback', () => {
  beforeEach(async () => {
    resetDbForTests(`kanjium-${createId('db')}`);
    await ensureSettings();
    resetKanjiumPitchCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetKanjiumPitchCache();
  });

  async function seed(suggestions: VocabularySuggestion[]) {
    const now = new Date().toISOString();
    await getDb().sentences.add({
      id: 'sent-1',
      normalizedKey: 'sent-1',
      japanese: '橋を渡る。',
      readingOnly: '',
      inlineReading: '',
      translation: '',
      targetVocabulary: [],
      vocabularySuggestions: suggestions,
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 0,
      importBatchIds: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  it('marks an unlinked citation-form word from the table', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(TABLE))));
    await seed([suggestion({ surface: '橋', expression: '橋', reading: 'はし' })]);
    expect(await getSentencePitchAccentTargets('sent-1')).toEqual([
      { surfaceForm: '橋', reading: 'はし', pitchAccentPositions: [2] },
    ]);
  });

  it('adds no marks when the table cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await seed([suggestion({ surface: '橋', expression: '橋', reading: 'はし' })]);
    expect(await getSentencePitchAccentTargets('sent-1')).toEqual([]);
  });
});
