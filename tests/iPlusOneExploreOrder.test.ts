import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addMinutesToTodaySession,
  addSentencesToBook,
  createBook,
  getDb,
  setBookSentenceStatus,
  updateSettings,
} from '../src/db/repository';
import type { Sentence, VocabularySuggestion } from '../src/domain/types';
import { createId } from '../src/lib/ids';

const T = '2026-11-07T00:00:00.000Z';

function sentenceOf(id: string, words: string[]): Sentence {
  let at = 0;
  const vocabularySuggestions: VocabularySuggestion[] = words.map((word, i) => {
    const token = {
      id: `${id}-t${i}`, surface: word, start: at, end: at + word.length, expression: word, reading: word,
      pos: '名詞/普通名詞', source: 'morphology' as const, selectedByDefault: true,
    };
    at += word.length;
    return token;
  });
  return {
    id, normalizedKey: id, japanese: words.join(''), readingOnly: '', inlineReading: '', translation: `tr ${id}`,
    targetVocabulary: [], vocabularySuggestions, sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0,
    importBatchIds: [], createdAt: T, updatedAt: T,
  };
}

async function lessonOrder(): Promise<string[]> {
  const session = await addMinutesToTodaySession(60);
  return session.steps.filter((step) => step.targetKind === 'sentence_learning').map((step) => step.sentenceId!);
}

/** One finished sentence (so 猫 and 犬 are known) then three new ones, in reading order hard -> i+1 -> all-known. */
async function seed(): Promise<void> {
  const book = await createBook({ title: 'i+1 Book' });
  const rows = [
    sentenceOf('done', ['猫', '犬']),
    sentenceOf('hard', ['雨', '傘', '風', '雲']),
    sentenceOf('i1', ['猫', '空']),
    sentenceOf('easy', ['猫', '犬']),
  ];
  await getDb().sentences.bulkPut(rows);
  await addSentencesToBook(book.id, rows.map((row) => row.id));
  await setBookSentenceStatus(book.id, 'done', 'complete');
}

describe('walkthrough supply: i+1 ordering (settings.iPlusOneOrdering)', () => {
  beforeEach(() => {
    resetDbForTests(`i-plus-one-${createId('db')}`);
  });

  it('keeps reading order while the setting is off', async () => {
    await seed();
    expect(await lessonOrder()).toEqual(['hard', 'i1', 'easy']);
  });

  it('offers the almost-known sentence first when on, without dropping anything', async () => {
    await seed();
    await updateSettings({ iPlusOneOrdering: true });
    expect(await lessonOrder()).toEqual(['i1', 'easy', 'hard']);
  });

  it('does nothing in sequential study mode, which keeps its strict episode order', async () => {
    await seed();
    await updateSettings({ iPlusOneOrdering: true, sequentialStudyMode: true });
    expect(await lessonOrder()).toEqual(['hard', 'i1', 'easy']);
  });
});
