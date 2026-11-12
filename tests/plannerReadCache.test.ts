import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  createBook,
  getDb,
  getSessionPlannerInput,
  setBookSuspended,
  warmPlannerReads,
} from '../src/db/repository';
import type { Sentence } from '../src/domain/types';
import { createId } from '../src/lib/ids';

function makeSentence(japanese: string): Sentence {
  const timestamp = new Date().toISOString();
  const id = createId('sent');
  return {
    id,
    normalizedKey: id,
    japanese,
    readingOnly: '',
    inlineReading: '',
    translation: 'x',
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** The planner keeps whole-table reads between taps; a write must make the next tap see it. */
describe('planner read cache', () => {
  beforeEach(async () => {
    resetDbForTests(`planner-cache-${createId('db')}`);
  });

  async function addSentences(bookId: string, texts: string[]) {
    const sentences = texts.map(makeSentence);
    await getDb().sentences.bulkPut(sentences);
    await addSentencesToBook(bookId, sentences.map((sentence) => sentence.id));
    return sentences;
  }

  const exploreSentenceCount = async () =>
    (await getSessionPlannerInput(60)).exploreCandidates.reduce((total, candidate) => total + candidate.sentences.length, 0);

  it('sees sentences added after the cache was warmed', async () => {
    const book = await createBook({ title: 'Cache' });
    await addSentences(book.id, ['今日は雨です。']);
    await warmPlannerReads();
    expect(await exploreSentenceCount()).toBe(1);

    await addSentences(book.id, ['明日は晴れです。', '昨日は曇りでした。']);
    expect(await exploreSentenceCount()).toBe(3);
  });

  it('stops offering a book that is shelved after the cache was warmed', async () => {
    const book = await createBook({ title: 'Shelved later' });
    await addSentences(book.id, ['今日は雨です。']);
    await warmPlannerReads();
    expect(await exploreSentenceCount()).toBe(1);

    await setBookSuspended(book.id, true);
    expect(await exploreSentenceCount()).toBe(0);
  });

  it('gives the same plan on a second tap as on the first', async () => {
    const book = await createBook({ title: 'Repeat' });
    await addSentences(book.id, ['今日は雨です。', '明日は晴れです。']);
    const first = await getSessionPlannerInput(60);
    const second = await getSessionPlannerInput(60);
    expect(second.exploreCandidates).toEqual(first.exploreCandidates);
    expect(second.shadowCandidates).toEqual(first.shadowCandidates);
    expect(second.readCheckCandidates).toEqual(first.readCheckCandidates);
  });
});
