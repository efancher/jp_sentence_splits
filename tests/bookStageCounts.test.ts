import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  assignBookSentencesToChapter,
  createBook,
  createBookChapter,
  ensureStudyItem,
  getBookStageCounts,
  getDb,
  setChapterSuspended,
} from '../src/db/repository';
import type { Sentence } from '../src/domain/types';
import { createId } from '../src/lib/ids';

const T = '2026-10-28T00:00:00.000Z';

function makeSentence(): Sentence {
  const id = createId('sent');
  return {
    id, normalizedKey: id, japanese: '猫が寝ています。', readingOnly: '', inlineReading: '', translation: 'tr',
    targetVocabulary: [], vocabularySuggestions: [], sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0,
    importBatchIds: [], createdAt: T, updatedAt: T,
  };
}

describe('getBookStageCounts', () => {
  beforeEach(() => {
    resetDbForTests(`book-stage-counts-${createId('db')}`);
  });

  it('separates untouched from awaiting-first-review sentences and leaves suspended episodes out of the total', async () => {
    const book = await createBook({ title: 'Stages' });
    const [untouched, awaiting, shelved] = [makeSentence(), makeSentence(), makeSentence()];
    await getDb().sentences.bulkPut([untouched, awaiting, shelved]);
    await addSentencesToBook(book.id, [untouched.id, awaiting.id, shelved.id]);
    const open = await createBookChapter(book.id, 'Open');
    const closed = await createBookChapter(book.id, 'Closed');
    await assignBookSentencesToChapter(book.id, [untouched.id, awaiting.id], open.id);
    await assignBookSentencesToChapter(book.id, [shelved.id], closed.id);
    await setChapterSuspended(book.id, closed.id, true);
    await ensureStudyItem('sentence', awaiting.id, 'reading_in_context');

    const stats = (await getBookStageCounts()).get(book.id)!;
    expect(stats.total).toBe(2);
    expect(stats.shelved).toBe(1);
    expect(stats.counts.new).toBe(1);
    expect(stats.counts.awaiting).toBe(1);
  });
});
