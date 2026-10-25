import { beforeEach, describe, expect, it } from 'vitest';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  createBook,
  ensureStudyItem,
  getDb,
  getSentenceReviewHistory,
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
  provenance: 'manual' as const,
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
    const history = await getSentenceReviewHistory(ids[0]!);
    expect(history.meaningChoices).toHaveLength(2);
    expect(history.meaningChoices[1]!.chosenText).toBe(CHECK.options[1]);
    expect(history.missedReadings).toEqual([]);
  });

  it('loads only the active sentence reading history, including older duplicate items, in timestamp order', async () => {
    const { ids } = await seedBook(2);
    const db = getDb();
    const reading = await ensureStudyItem('sentence', ids[0]!, 'reading_in_context');
    const listening = await ensureStudyItem('sentence', ids[0]!, 'listening');
    const other = await ensureStudyItem('sentence', ids[1]!, 'reading_in_context');
    const otherType = await ensureStudyItem('vocabularyItem', ids[0]!, 'reading_in_context');
    await db.studyItems.put({ ...reading, id: 'duplicate-reading' });
    await db.reviews.bulkPut([
      { id: 'a-newest', studyItemId: reading.id, timestamp: '2026-01-03T00:00:00.000Z', rating: 'good', meaningChoice: record(true), missedReadings: ['猫'] },
      { id: 'z-oldest', studyItemId: 'duplicate-reading', timestamp: '2026-01-01T00:00:00.000Z', rating: 'again', meaningChoice: record(false), missedReadings: ['寝ています'] },
      ...[listening, other, otherType].map((item) => ({ id: `unrelated-${item.id}`, studyItemId: item.id, timestamp: '2026-01-04T00:00:00.000Z', rating: 'good' as const, meaningChoice: record(false), missedReadings: ['unrelated'] })),
    ]);
    expect(await getSentenceReviewHistory(ids[0]!)).toEqual({
      meaningChoices: [record(false), record(true)], missedReadings: ['猫'],
    });
    // A later legacy review without supplementary evidence clears the reading
    // flag while retaining earlier meaning-choice attempts.
    await db.reviews.add({ id: 'cleared', studyItemId: reading.id, timestamp: '2026-01-05T00:00:00.000Z', rating: 'good' });
    expect(await getSentenceReviewHistory(ids[0]!)).toEqual({
      meaningChoices: [record(false), record(true)], missedReadings: [],
    });
    expect(await getSentenceReviewHistory('missing')).toEqual({ meaningChoices: [], missedReadings: [] });
  });

  it('opens only the first sentence on a fresh book', async () => {
    const { book } = await seedBook(3);
    const status = await getSequentialBookStatus(book.id);
    expect(status.sentences.map((s) => s.accessible)).toEqual([true, false, false]);
    expect(status.frontier?.position).toBe(status.sentences[1]!.position);
  });

  it('opens the rest of the episode once one sentence has been answered, and keeps it open', async () => {
    const { book, ids } = await seedBook(3);
    await answer(ids[0]!, [true]);
    await latchSequentialUnlocks(book.id);
    await answer(ids[0]!, [false, false, false, false, false], 5);
    const status = await getSequentialBookStatus(book.id);
    expect(status.sentences.map((s) => s.accessible)).toEqual([true, true, true]);
  });

  it('a sentence worked on out of order opens the others without needing the first', async () => {
    const { book, ids } = await seedBook(3, false);
    await getDb().bookSentences.where('sentenceId').equals(ids[2]!).modify({ status: 'complete' });
    const status = await getSequentialBookStatus(book.id);
    expect(status.sentences.map((s) => s.accessible)).toEqual([true, true, true]);
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
