import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addMinutesToTodaySession,
  addSentencesToBook,
  computeLearningBalance,
  confirmSentenceVocabulary,
  createBook,
  endPlannerSessionEarly,
  ensureStudyItem,
  getDb,
  getPlannerSession,
  getTodayPlannerSession,
  planRecommendedSession,
  recordReview,
  setBookSentenceStatus,
  updatePlannerSessionStep,
} from '../src/db/repository';
import type { Sentence } from '../src/domain/types';
import { createId } from '../src/lib/ids';

function makeSentence(overrides: Partial<Sentence> = {}): Sentence {
  const timestamp = new Date().toISOString();
  const id = overrides.id ?? createId('sent');
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
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('Learning Orchestrator repository layer', () => {
  beforeEach(() => {
    resetDbForTests(`session-planner-${createId('db')}`);
  });

  it('surfaces unstarted book sentences as an Explore step, with no retain minutes when nothing is due', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentences = [makeSentence(), makeSentence(), makeSentence()];
    await db.sentences.bulkPut(sentences);
    await addSentencesToBook(
      book.id,
      sentences.map((s) => s.id),
    );

    const recommended = await planRecommendedSession(30);
    expect(recommended.allocation.retain).toBe(0);
    const exploreStep = recommended.steps.find((step) => step.mode === 'explore');
    expect(exploreStep).toBeDefined();
    expect(exploreStep!.bookId).toBe(book.id);
  });

  it('tracks step completion/skip explicitly, and only completes the session once every step is settled', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);
    // A brand-new StudyItem is immediately due, giving a second (retain) step.
    await ensureStudyItem('sentence', sentence.id, 'comprehension');

    const session = await addMinutesToTodaySession(30);
    expect(session.steps.length).toBeGreaterThanOrEqual(2);
    expect(session.status).toBe('in_progress');
    expect(session.steps.every((step) => step.status === 'pending')).toBe(true);
    // Real, freshly-minted ids — not the pure algorithm's draft_N placeholders.
    expect(session.steps.every((step) => step.id.startsWith('planner_step_'))).toBe(true);

    const [first, ...rest] = session.steps;
    const afterSkip = await updatePlannerSessionStep(session.id, first!.id, { status: 'skipped' });
    expect(afterSkip!.steps.find((step) => step.id === first!.id)!.status).toBe('skipped');
    // One step settled, others still pending — the session as a whole isn't done yet.
    expect(afterSkip!.status).toBe('in_progress');

    let afterComplete = afterSkip;
    for (const step of rest) {
      afterComplete = await updatePlannerSessionStep(session.id, step!.id, {
        status: 'completed',
      });
    }
    expect(afterComplete!.status).toBe('completed');
    expect(afterComplete!.endedAt).toBeDefined();
  });

  it('real completion (finishing the sentence, confirming vocabulary) auto-settles the matching session step', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);

    const session = await addMinutesToTodaySession(30);
    const continueStep = session.steps.find((step) => step.targetKind === 'continue_book');
    const vocabStep = session.steps.find((step) => step.targetKind === 'vocabulary_review');
    expect(continueStep).toBeDefined();
    expect(vocabStep).toBeDefined();
    expect(continueStep!.sentenceId).toBe(sentence.id);
    expect(vocabStep!.sentenceId).toBe(sentence.id);

    // Finishing the sentence auto-completes only the continue_book step.
    await setBookSentenceStatus(book.id, sentence.id, 'complete');
    let updated = await getPlannerSession(session.id);
    expect(updated!.steps.find((step) => step.id === continueStep!.id)!.status).toBe('completed');
    expect(updated!.steps.find((step) => step.id === vocabStep!.id)!.status).toBe('pending');

    // Confirming vocabulary auto-completes only the vocabulary_review step.
    await confirmSentenceVocabulary(sentence.id, []);
    updated = await getPlannerSession(session.id);
    expect(updated!.steps.find((step) => step.id === vocabStep!.id)!.status).toBe('completed');
  });

  it('ending a session early marks remaining steps skipped, never completed', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);

    const session = await addMinutesToTodaySession(30);
    const ended = await endPlannerSessionEarly(session.id);

    expect(ended!.status).toBe('ended_early');
    expect(ended!.steps.every((step) => step.status !== 'completed')).toBe(true);
    expect(ended!.steps.every((step) => step.status === 'skipped')).toBe(true);
  });

  it('addMinutesToTodaySession creates one session per day and tops it up rather than creating a second', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentences = [makeSentence(), makeSentence()];
    await db.sentences.bulkPut(sentences);
    await addSentencesToBook(book.id, sentences.map((s) => s.id));

    const first = await addMinutesToTodaySession(30);
    expect(first.targetMinutes).toBe(30);

    const second = await addMinutesToTodaySession(20);
    expect(second.id).toBe(first.id);
    expect(second.targetMinutes).toBe(50);
    expect(second.steps.length).toBeGreaterThanOrEqual(first.steps.length);
    // Every step from the first pass survives untouched in the topped-up session.
    for (const step of first.steps) {
      expect(second.steps.find((s) => s.id === step.id)).toBeDefined();
    }

    const today = await getTodayPlannerSession();
    expect(today!.id).toBe(first.id);

    const all = await db.plannerSessions.toArray();
    expect(all).toHaveLength(1);
  });

  it('a top-up does not re-suggest a book already given a pending Explore step', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentences = [makeSentence(), makeSentence(), makeSentence()];
    await db.sentences.bulkPut(sentences);
    await addSentencesToBook(book.id, sentences.map((s) => s.id));

    const first = await addMinutesToTodaySession(30);
    const exploreStepsAfterFirst = first.steps.filter((step) => step.mode === 'explore');
    expect(exploreStepsAfterFirst.length).toBeGreaterThan(0);

    const second = await addMinutesToTodaySession(30);
    const exploreStepsAfterSecond = second.steps.filter((step) => step.mode === 'explore');
    // No second "continue this book" step for the same still-unstarted book.
    expect(exploreStepsAfterSecond.length).toBe(exploreStepsAfterFirst.length);
  });

  it('a top-up reopens a session that had already settled all its steps, once it finds something new', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);

    const first = await addMinutesToTodaySession(30);
    for (const step of first.steps) {
      await updatePlannerSessionStep(first.id, step.id, { status: 'completed' });
    }
    const settled = await getTodayPlannerSession();
    expect(settled!.status).toBe('completed');

    // A second book gives the top-up something new to recommend.
    const otherBook = await createBook({ title: 'Another Book' });
    const otherSentence = makeSentence();
    await db.sentences.put(otherSentence);
    await addSentencesToBook(otherBook.id, [otherSentence.id]);

    const topped = await addMinutesToTodaySession(20);
    expect(topped.id).toBe(first.id);
    expect(topped.status).toBe('in_progress');
    expect(topped.endedAt).toBeUndefined();
    expect(topped.steps.length).toBeGreaterThan(first.steps.length);
  });

  it('learning balance reflects real recent Review activity, not the planner\'s own bookkeeping', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);
    const studyItem = await ensureStudyItem('sentence', sentence.id, 'comprehension');
    await recordReview({ studyItemId: studyItem.id, rating: 'good' });

    const balance = await computeLearningBalance();
    const retain = balance.find((entry) => entry.mode === 'retain')!;
    const understand = balance.find((entry) => entry.mode === 'understand')!;
    expect(retain.neglectScore).toBeLessThan(understand.neglectScore);
    expect(understand.daysSinceLast).toBeNull();
  });
});
