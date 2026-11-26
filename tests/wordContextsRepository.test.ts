import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { addSentencesToBook, createBook, getDb, loadOtherWordContexts, setBookSentenceStatus } from '../src/db/repository';
import type { Sentence } from '../src/domain/types';
import { createId } from '../src/lib/ids';

const T = '2026-11-26T00:00:00.000Z';

function sentenceOf(id: string, japanese: string, words: string[]): Sentence {
  return {
    id, normalizedKey: id, japanese, readingOnly: '', inlineReading: '', translation: `tr ${id}`,
    targetVocabulary: [], sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0, importBatchIds: [], createdAt: T, updatedAt: T,
    vocabularySuggestions: words.map((word, i) => ({
      id: `${id}-t${i}`, surface: word, start: i, end: i + 1, expression: word, reading: word,
      pos: '名詞/普通名詞', source: 'morphology' as const, selectedByDefault: true,
    })),
  };
}

describe('loadOtherWordContexts', () => {
  beforeEach(() => resetDbForTests(`word-contexts-${createId('db')}`));

  it('offers only introduced sentences with a different context for the word', async () => {
    const book = await createBook({ title: 'Contexts' });
    const rows = [
      sentenceOf('here', '今日のトピックは習慣です。', ['今日', 'トピック', '習慣']),
      sentenceOf('repeat', '今日のトピックは習慣です。', ['今日', 'トピック', '習慣']),
      sentenceOf('other', '早起きが習慣だ。', ['早起き', '習慣']),
      sentenceOf('unstudied', '悪い習慣をやめる。', ['悪い', '習慣', 'やめる']),
    ];
    await getDb().sentences.bulkPut(rows);
    await addSentencesToBook(book.id, rows.map((row) => row.id));
    for (const id of ['here', 'repeat', 'other']) await setBookSentenceStatus(book.id, id, 'complete');

    const found = await loadOtherWordContexts('here', ['習慣']);
    expect(found.get('習慣')?.map((item) => item.sentenceId)).toEqual(['other']);
  });
});
