import { beforeEach, describe, expect, it } from 'vitest';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  createBook,
  ensureStudyItem,
  getDb,
  getMeaningChoiceRecords,
  getSequentialBookStatus,
  getSequentialSentenceView,
  latchSequentialUnlocks,
  recordReview,
  setSentenceComprehensionCheck,
  unlockSentenceManually,
  updateSettings,
} from '../src/db/repository';
import type { MeaningChoiceRecord } from '../src/domain/types';
import { createId } from '../src/lib/ids';

function makeSentence(id: string) {
  const now = new Date().toISOString();
  return {
    id,
    normalizedKey: id,
    japanese: '猫が寝ています。',
    readingOnly: 'ねこがねています。',
    inlineReading: '',
    translation: 'The cat is sleeping.',
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

const CHECK = {
  options: [
    'The cat is sleeping.',
    'The cat is not sleeping.',
    'The dog is sleeping.',
    'The cat slept all day.',
  ],
  correctIndex: 0,
  source: 'manual' as const,
  createdAt: new Date().toISOString(),
};

async function seedBook(count: number, withChecks = true) {
  const book = await createBook({ title: 'Episode' });
  const sentences = Array.from({ length: count }, () => makeSentence(createId('sent')));
  await getDb().sentences.bulkPut(sentences);
  await addSentencesToBook(book.id, sentences.map((s) => s.id));
  if (withChecks) {
    for (const s of sentences) await setSentenceComprehensionCheck(s.id, CHECK);
  }
  return { book, ids: sentences.map((s) => s.id) };
}

function record(correct: boolean): MeaningChoiceRecord {
  return {
    shown: CHECK.options,
    chosenIndex: correct ? 0 : 1,
    chosenText: correct ? CHECK.options[0]! : CHECK.options[1]!,
    correctText: CHECK.options[0]!,
    correct,
    qualifying: true,
  };
}

/** Five qualifying attempts a day apart; `correctCount` of them right. */
async function answer(sentenceId: string, results: boolean[], startDay = 0) {
  const item = await ensureStudyItem('sentence', sentenceId, 'reading_in_context');
  const base = Date.now() - 30 * 24 * 3600 * 1000;
  for (const [index, ok] of results.entries()) {
    await recordReview({
      studyItemId: item.id,
      rating: ok ? 'good' : 'again',
      now: new Date(base + (startDay + index) * 24 * 3600 * 1000),
      comprehensionCheckCorrect: ok,
      comprehensionCheckChosenIndex: ok ? 0 : 1,
      meaningChoice: record(ok),
    });
  }
}

describe('sentence-led flow repository', () => {
  beforeEach(async () => {
    resetDbForTests(`sentence-led-${createId('db')}`);
    await ensureSettings();
    await updateSettings({ sequentialStudyMode: true });
  });

  it('stores the meaning choice record with the review and returns it per sentence', async () => {
    const { ids } = await seedBook(1);
    await answer(ids[0]!, [true, false]);
    const records = await getMeaningChoiceRecords(ids);
    expect(records.get(ids[0]!)).toHaveLength(2);
    expect(records.get(ids[0]!)![1]!.chosenText).toBe(CHECK.options[1]);
  });

  it('opens only the first sentence on a fresh book', async () => {
    const { book } = await seedBook(3);
    const status = await getSequentialBookStatus(book.id);
    expect(status.sentences.map((s) => s.accessible)).toEqual([true, false, false]);
    expect(status.frontier?.position).toBe(status.sentences[1]!.position);
  });

  it('unlocks the next sentence at 4 of 5 and keeps it unlocked afterwards', async () => {
    const { book, ids } = await seedBook(3);
    await answer(ids[0]!, [true, true, false, true, true]);
    let status = await getSequentialBookStatus(book.id);
    expect(status.sentences.map((s) => s.accessible)).toEqual([true, true, false]);

    await latchSequentialUnlocks(book.id);
    // A later run of misses on sentence 1 must not re-lock sentence 2.
    await answer(ids[0]!, [false, false, false, false, false], 5);
    status = await getSequentialBookStatus(book.id);
    expect(status.sentences[1]!.accessible).toBe(true);
  });

  it('does not unlock at 3 of 5, or with fewer than 5 attempts', async () => {
    const { book, ids } = await seedBook(2);
    await answer(ids[0]!, [true, true, true, true]);
    expect((await getSequentialBookStatus(book.id)).sentences[1]!.accessible).toBe(false);
    await answer(ids[0]!, [false], 4);
    // Window is now T,T,T,T,F... plus the earlier four: last five = T,T,T,T,F -> 4 of 5.
    expect((await getSequentialBookStatus(book.id)).sentences[1]!.accessible).toBe(true);
  });

  it('a sentence without a usable check never blocks the next one', async () => {
    const { book, ids } = await seedBook(3, false);
    await setSentenceComprehensionCheck(ids[0]!, undefined);
    const status = await getSequentialBookStatus(book.id);
    expect(status.sentences[0]!.waived).toBe(true);
    expect(status.sentences[1]!.accessible).toBe(true);
  });

  it('legacy reviews without a meaningChoice record still count', async () => {
    const { book, ids } = await seedBook(2);
    const item = await ensureStudyItem('sentence', ids[0]!, 'reading_in_context');
    const base = Date.now() - 30 * 24 * 3600 * 1000;
    for (let i = 0; i < 5; i += 1) {
      await recordReview({
        studyItemId: item.id,
        rating: 'good',
        now: new Date(base + i * 24 * 3600 * 1000),
        comprehensionCheckCorrect: true,
        comprehensionCheckChosenIndex: 0,
      });
    }
    expect((await getSequentialBookStatus(book.id)).sentences[1]!.accessible).toBe(true);
  });

  it('manual unlock opens a locked sentence permanently', async () => {
    const { book, ids } = await seedBook(2);
    await unlockSentenceManually(ids[1]!);
    expect((await getSequentialBookStatus(book.id)).sentences[1]!.accessible).toBe(true);
  });

  it('view is undefined when sequential mode is off', async () => {
    const { book, ids } = await seedBook(2);
    await updateSettings({ sequentialStudyMode: false });
    expect(await getSequentialSentenceView(book.id, ids[0]!)).toBeUndefined();
  });
});
