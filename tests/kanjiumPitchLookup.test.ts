import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb, getSentencePitchAccentTargets } from '../src/db/repository';
import type { VocabularySuggestion } from '../src/domain/types';
import { createId } from '../src/lib/ids';
import {
  buildKanjiumPitchLookup,
  kanjiumTargetsForSuggestions,
  resetKanjiumPitchCache,
} from '../src/lib/kanjiumPitchLookup';

const TABLE: Record<string, string> = {
  '橋|はし': '2',
  '箸|はし': '1',
  '有る|ある': '1',
  '其の|その': '0',
  '日本|にほん': '2',
  '田中|たなか': '0',
  '種|たね': '0',
  '胤|たね': '0',
};

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
    expect(lookup.find('橋', 'はし')).toBe(2);
    expect(lookup.find('日本', 'ニホン')).toBe(2);
  });

  it('uses a reading-only match for kana lemmas when every entry agrees', () => {
    expect(lookup.find('その', 'その')).toBe(0);
    expect(lookup.find('ある', 'ある')).toBe(1);
    expect(lookup.find('たね', 'たね')).toBe(0);
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
    );
    expect(targets).toEqual([{ surfaceForm: '橋', reading: 'はし', pitchAccentPositions: [2] }]);
  });

  it('skips words a vocabulary link already marked', () => {
    const targets = kanjiumTargetsForSuggestions(
      [suggestion({ surface: '橋', expression: '橋', reading: 'はし' })],
      lookup,
      new Set(['橋']),
    );
    expect(targets).toEqual([]);
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
