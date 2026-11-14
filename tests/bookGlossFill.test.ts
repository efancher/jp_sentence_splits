import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb } from '../src/db/repository';
import { createId } from '../src/lib/ids';

const glossWordsViaAssist = vi.fn();
vi.mock('../src/lib/assistGlosses', () => ({
  glossWordsViaAssist: (...args: unknown[]) => glossWordsViaAssist(...args),
}));

import { countBookSentencesNeedingGloss, fillBookGlosses } from '../src/lib/sentenceGlossFill';

const suggestion = (expression: string, extra = {}) => ({
  id: `v-${expression}`,
  start: 0,
  end: 1,
  expression,
  reading: expression,
  selectedByDefault: true,
  ...extra,
});

async function seed() {
  const db = getDb();
  const now = new Date().toISOString();
  const rows: [string, ReturnType<typeof suggestion>[]][] = [
    ['s1', [suggestion('種類')]],
    ['s2', [suggestion('緑茶', { english: 'green tea' })]],
    ['s3', [suggestion('実'), suggestion('いろいろ')]],
  ];
  for (const [index, [id, vocabularySuggestions]] of rows.entries()) {
    await db.sentences.put({
      id,
      normalizedKey: id,
      japanese: `文${id}。`,
      readingOnly: '',
      inlineReading: '',
      translation: 't',
      targetVocabulary: [],
      vocabularySuggestions,
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 0,
      importBatchIds: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    await db.bookSentences.put({
      id: `bs_${id}`,
      bookId: 'b1',
      sentenceId: id,
      position: index,
      status: 'unstarted',
      addedAt: now,
    } as never);
  }
}

describe('book-wide gloss fill', () => {
  beforeEach(async () => {
    resetDbForTests(`book-gloss-${createId('db')}`);
    glossWordsViaAssist.mockReset();
    await seed();
  });

  it('glosses only sentences missing glosses and persists them', async () => {
    expect(await countBookSentencesNeedingGloss('b1')).toBe(2);
    glossWordsViaAssist.mockImplementation(async (_sentence: string, words: { expression: string }[]) =>
      words.map((word) => ({ expression: word.expression, meaning: `gloss of ${word.expression}` })),
    );
    const result = await fillBookGlosses('b1');
    expect(result).toMatchObject({ total: 2, filled: 2, empty: 0, cancelled: false });
    expect(glossWordsViaAssist).toHaveBeenCalledTimes(2);
    const saved = await getDb().sentences.get('s3');
    expect(saved!.vocabularySuggestions.map((item) => item.english)).toEqual(['gloss of 実', 'gloss of いろいろ']);
    expect(await countBookSentencesNeedingGloss('b1')).toBe(0);
  });

  it('counts a sentence as empty when the assistant returns nothing and leaves it for a rerun', async () => {
    glossWordsViaAssist.mockResolvedValue([]);
    const result = await fillBookGlosses('b1');
    expect(result).toMatchObject({ total: 2, filled: 0, empty: 2 });
    expect(await countBookSentencesNeedingGloss('b1')).toBe(2);
  });

  it('stops handing out sentences once cancelled', async () => {
    glossWordsViaAssist.mockResolvedValue([]);
    const result = await fillBookGlosses('b1', { isCancelled: () => glossWordsViaAssist.mock.calls.length >= 1 });
    expect(glossWordsViaAssist).toHaveBeenCalledTimes(1);
    expect(result.cancelled).toBe(true);
  });
});
