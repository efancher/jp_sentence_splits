import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  confirmSentenceVocabulary,
  createBook,
  ensureSettings,
  ensureStudyItem,
  getDb,
  getReviewTroubleReport,
  getSessionPlannerInput,
  listSentenceLearningEvents,
  logSentenceLearningEvent,
  recordReview,
  recordReviewTroubleTags,
  saveAttempt,
  setBookSentenceStatus,
  updateSettings,
} from '../src/db/repository';
import { normalizeTroubleTags, routeTroubleTags } from '../src/lib/reviewTroubleTags';
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

describe('trouble tag routing (pure)', () => {
  it('sends knowledge gaps to a fresh try', () => {
    expect(routeTroubleTags(['reading'])).toEqual({ freshTry: true });
    expect(routeTroubleTags(['kanji', 'meaning'])).toEqual({ freshTry: true });
    expect(routeTroubleTags([])).toEqual({ freshTry: false });
  });

  it('normalizes to a de-duplicated display order', () => {
    // The removed 'sound' tag is dropped if an old caller still passes it.
    expect(normalizeTroubleTags(['sound', 'meaning', 'reading', 'meaning'])).toEqual(['reading', 'meaning']);
  });
});

describe('recordReviewTroubleTags', () => {
  beforeEach(() => {
    resetDbForTests(`trouble-tags-${createId('db')}`);
  });

  async function shadowReadySentence(book: { id: string }, japanese: string): Promise<Sentence> {
    const db = getDb();
    const sentence = makeSentence(japanese);
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);
    await setBookSentenceStatus(book.id, sentence.id, 'in_progress');
    await confirmSentenceVocabulary(sentence.id, []);
    await db.sentenceAudio.add({
      id: `audio-${sentence.id}`,
      sentenceId: sentence.id,
      sourceId: 'source-1',
      sourceSentenceId: `src-${sentence.id}`,
      sourceTitle: 'Test Source',
      mimeType: 'audio/mp3',
      durationMs: 1500,
      startMs: 0,
      endMs: 1500,
      blob: new Blob(['fake audio bytes'], { type: 'audio/mp3' }),
      importedAt: new Date().toISOString(),
    });
    return sentence;
  }

  it('does nothing without tags', async () => {
    const item = await ensureStudyItem('sentence', 'sent-none', 'reading_in_context');
    expect(
      await recordReviewTroubleTags({
        studyItemId: item.id,
        sentenceId: 'sent-none',
        rating: 'hard',
        tags: [],
      }),
    ).toBeUndefined();
    expect(await getDb().reviewTroubleLogs.count()).toBe(0);
  });

  it('queues a fresh try only for a walked-through sentence, and logs what was queued', async () => {
    const book = await createBook({ title: 'Tags' });
    const walked = makeSentence('猫が寝ています。');
    const unwalked = makeSentence('犬が走ります。');
    await getDb().sentences.bulkPut([walked, unwalked]);
    await addSentencesToBook(book.id, [walked.id, unwalked.id]);
    await logSentenceLearningEvent({ sentenceId: walked.id, bookId: book.id, action: 'walkthrough_completed' });
    const item = await ensureStudyItem('sentence', walked.id, 'reading_in_context');

    const walkedLog = await recordReviewTroubleTags({
      studyItemId: item.id,
      sentenceId: walked.id,
      rating: 'hard',
      tags: ['reading'],
    });
    const unwalkedLog = await recordReviewTroubleTags({
      studyItemId: item.id,
      sentenceId: unwalked.id,
      rating: 'again',
      tags: ['meaning'],
    });

    expect(walkedLog?.queued).toEqual({ freshTry: true, shadow: false });
    expect(unwalkedLog?.queued).toEqual({ freshTry: false, shadow: false });
    const settings = await ensureSettings(getDb());
    expect(Object.keys(settings.freshTryRequests ?? {})).toEqual([walked.id]);
    // No FSRS side effects: tagging records no review and no learning event beyond the walkthrough.
    expect(await getDb().reviews.count()).toBe(0);
    expect((await listSentenceLearningEvents(book.id)).map((event) => event.action)).toEqual([
      'walkthrough_completed',
    ]);
  });

  it('reports tags, queued follow-ups and the next review from stored data', async () => {
    const book = await createBook({ title: 'Report' });
    const sentence = makeSentence('猫が寝ています。');
    await getDb().sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);
    await logSentenceLearningEvent({ sentenceId: sentence.id, bookId: book.id, action: 'walkthrough_completed' });
    const item = await ensureStudyItem('sentence', sentence.id, 'reading_in_context');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordReviewTroubleTags({ studyItemId: item.id, sentenceId: sentence.id, rating: 'hard', tags: ['reading'] });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await logSentenceLearningEvent({ sentenceId: sentence.id, bookId: book.id, action: 'expression_attempt' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordReview({ studyItemId: item.id, rating: 'good', contextSentenceId: sentence.id });

    const report = await getReviewTroubleReport();
    expect(report.taggedReviews).toBe(1);
    expect(report.freshTry).toEqual({ queued: 1, done: 1 });
    expect(report.followedUp).toEqual({ n: 1, nextGoodOrEasy: 1 });
  });
});
