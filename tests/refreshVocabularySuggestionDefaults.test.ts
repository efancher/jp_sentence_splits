import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb, refreshVocabularySuggestionDefaults } from '../src/db/repository';
import type { VocabularySuggestion } from '../src/domain/types';

beforeEach(async () => {
  await resetDbForTests();
});

// Real fugashi/UniDic-derived suggestions for 次はこうしよう。, as
// suggestionsFromTokens would have produced before isDemonstrativeLightVerb
// existed — する wrongly checked by default.
function staleSuruSuggestions(): VocabularySuggestion[] {
  return [
    {
      id: 'v1',
      surface: '次',
      start: 0,
      end: 1,
      expression: '次',
      reading: 'つぎ',
      pos: '名詞/普通名詞',
      source: 'morphology',
      selectedByDefault: true,
    },
    {
      id: 'v2',
      surface: 'は',
      start: 1,
      end: 2,
      expression: 'は',
      reading: 'は',
      pos: '助詞/係助詞',
      source: 'morphology',
      selectedByDefault: false,
    },
    {
      id: 'v3',
      surface: 'こう',
      start: 2,
      end: 4,
      expression: 'こう',
      reading: 'こう',
      pos: '副詞',
      source: 'morphology',
      selectedByDefault: false,
    },
    {
      id: 'v4',
      surface: 'しよう',
      start: 4,
      end: 7,
      expression: 'する',
      reading: 'しよう',
      pos: '動詞/非自立可能',
      source: 'morphology',
      selectedByDefault: true, // stale — should flip to false
    },
  ];
}

async function seedSentence(id: string, suggestions: VocabularySuggestion[]) {
  const db = getDb();
  const now = new Date().toISOString();
  await db.sentences.add({
    id,
    normalizedKey: id,
    japanese: '次はこうしよう。',
    readingOnly: '',
    inlineReading: '',
    translation: "let's do it this way next",
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

describe('refreshVocabularySuggestionDefaults', () => {
  it('flips a stale selectedByDefault on an untouched sentence (no analysis row)', async () => {
    await seedSentence('s1', staleSuruSuggestions());
    const result = await refreshVocabularySuggestionDefaults();
    expect(result).toEqual({ sentencesScanned: 1, sentencesUpdated: 1, suggestionsChanged: 1 });
    const updated = await getDb().sentences.get('s1');
    expect(updated?.vocabularySuggestions.find((s) => s.expression === 'する')?.selectedByDefault).toBe(
      false,
    );
    // Untouched entries keep their exact object identity/value.
    expect(updated?.vocabularySuggestions.find((s) => s.expression === '次')?.selectedByDefault).toBe(
      true,
    );
  });

  it('skips a sentence whose analysis already has real selections', async () => {
    const db = getDb();
    await seedSentence('s2', staleSuruSuggestions());
    const now = new Date().toISOString();
    await db.analyses.add({
      sentenceId: 's2',
      chunks: [],
      notes: '',
      status: 'empty',
      formatVersion: 2,
      vocabularyReviewStatus: 'unreviewed',
      vocabularySelections: [
        {
          id: 'sel1',
          surface: 'する',
          start: 4,
          end: 7,
          expression: 'する',
          reading: 'しよう',
          english: '',
          source: 'suggestion',
          suggestionIds: ['v4'],
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
    const result = await refreshVocabularySuggestionDefaults();
    expect(result).toEqual({ sentencesScanned: 1, sentencesUpdated: 0, suggestionsChanged: 0 });
    const unchanged = await db.sentences.get('s2');
    expect(unchanged?.vocabularySuggestions.find((s) => s.expression === 'する')?.selectedByDefault).toBe(
      true,
    );
  });

  it('is a no-op when nothing needs to change', async () => {
    const already = staleSuruSuggestions().map((s) =>
      s.expression === 'する' ? { ...s, selectedByDefault: false } : s,
    );
    await seedSentence('s3', already);
    const result = await refreshVocabularySuggestionDefaults();
    expect(result).toEqual({ sentencesScanned: 1, sentencesUpdated: 0, suggestionsChanged: 0 });
  });
});
