import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addMinutesToTodaySession,
  addSentencesToBook,
  computeLearningBalance,
  confirmSentenceVocabulary,
  createBook,
  deleteTodayPlannerSession,
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
    expect(recommended.allocation.review).toBe(0);
    const exploreStep = recommended.steps.find((step) => step.bucket === 'glossing');
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

  it('a not-yet-confirmed sentence gets only its vocabulary_review step — continue_book is withheld until vocab is confirmed and proficient (2026-08-27)', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);

    const session = await addMinutesToTodaySession(30);
    const vocabStep = session.steps.find((step) => step.targetKind === 'vocabulary_review');
    expect(vocabStep).toBeDefined();
    expect(vocabStep!.sentenceId).toBe(sentence.id);
    expect(session.steps.some((step) => step.targetKind === 'continue_book')).toBe(false);

    // The gate reads the sentence's analysis status, not the session step, so
    // confirming vocabulary (no real vocab items here → immediately "ready")
    // unlocks the continue_book step on the next day's plan even though the
    // vocabulary_review step itself was never explicitly settled.
    await confirmSentenceVocabulary(sentence.id, []);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const nextDaySession = await addMinutesToTodaySession(30, tomorrow);
    const continueStep = nextDaySession.steps.find((step) => step.targetKind === 'continue_book');
    expect(continueStep).toBeDefined();
    expect(continueStep!.sentenceId).toBe(sentence.id);
  });

  it('prefers a book that still needs vocabulary confirmed over more-recent fully-confirmed books when candidate slots are scarce (2026-08-29)', async () => {
    const db = getDb();

    // Oldest book: its next sentence still needs vocabulary confirmed.
    const backlogBook = await createBook({ title: 'Needs Vocab' });
    const backlogSentence = makeSentence();
    await db.sentences.put(backlogSentence);
    await addSentencesToBook(backlogBook.id, [backlogSentence.id]);
    await db.books.update(backlogBook.id, { lastOpenedAt: '2026-01-01T00:00:00.000Z' });

    // Six more-recent books whose next sentence is already confirmed + proficient —
    // enough to fill every Explore candidate slot by recency alone.
    for (let i = 0; i < 6; i += 1) {
      const book = await createBook({ title: `Confirmed ${i}` });
      const sentence = makeSentence();
      await db.sentences.put(sentence);
      await addSentencesToBook(book.id, [sentence.id]);
      await confirmSentenceVocabulary(sentence.id, []);
      await db.books.update(book.id, { lastOpenedAt: `2026-08-2${i}T00:00:00.000Z` });
    }

    const recommended = await planRecommendedSession(30);
    const vocabStep = recommended.steps.find((step) => step.targetKind === 'vocabulary_review');
    expect(vocabStep).toBeDefined();
    expect(vocabStep!.sentenceId).toBe(backlogSentence.id);
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
    const exploreStepsAfterFirst = first.steps.filter((step) => step.bucket === 'glossing');
    expect(exploreStepsAfterFirst.length).toBeGreaterThan(0);

    const second = await addMinutesToTodaySession(30);
    const exploreStepsAfterSecond = second.steps.filter((step) => step.bucket === 'glossing');
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
    const review = balance.find((entry) => entry.bucket === 'review')!;
    const grammar = balance.find((entry) => entry.bucket === 'grammar')!;
    expect(review.neglectScore).toBeLessThan(grammar.neglectScore);
    expect(grammar.daysSinceLast).toBeNull();
  });

  it('gives a sentence no shadow step until its vocabulary is confirmed and proficient (user request, 2026-08-27)', async () => {
    const book = await createBook({ title: 'Shadow Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);
    // findShadowCandidates only considers sentences already "in progress" —
    // marking it unstarted-but-with-audio would exclude it from the pool
    // for an unrelated reason and defeat this test.
    await setBookSentenceStatus(book.id, sentence.id, 'in_progress');
    await db.sentenceAudio.add({
      id: 'audio-shadow-1',
      sentenceId: sentence.id,
      sourceId: 'source-1',
      sourceSentenceId: 'src-sent-1',
      sourceTitle: 'Test Source',
      mimeType: 'audio/mp3',
      durationMs: 1500,
      startMs: 0,
      endMs: 1500,
      blob: new Blob(['fake audio bytes'], { type: 'audio/mp3' }),
      importedAt: new Date().toISOString(),
    });

    const beforeConfirm = await planRecommendedSession(60);
    expect(beforeConfirm.steps.some((step) => step.targetKind === 'shadow')).toBe(false);

    await confirmSentenceVocabulary(sentence.id, []);
    const afterConfirm = await planRecommendedSession(60);
    const shadowStep = afterConfirm.steps.find((step) => step.targetKind === 'shadow');
    expect(shadowStep).toBeDefined();
    expect(shadowStep!.sentenceId).toBe(sentence.id);
  });

  it('deleteTodayPlannerSession removes today\'s session entirely, letting the next Start build a fresh one (user request, 2026-08-27: "clear out a session created with the wrong split")', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);

    const wrongSplit = { glossing: 1, grammar: 0, shadowing: 0, review: 0 };
    const first = await addMinutesToTodaySession(30, new Date(), wrongSplit);
    expect(first.allocation.glossing).toBeGreaterThan(0);
    expect(await db.plannerSessions.count()).toBe(1);

    await deleteTodayPlannerSession();
    expect(await getTodayPlannerSession()).toBeUndefined();
    expect(await db.plannerSessions.count()).toBe(0);

    // A fresh Start with a corrected split creates a brand-new session, not
    // a top-up of the deleted one.
    const correctedSplit = { glossing: 0, grammar: 0, shadowing: 0, review: 1 };
    const second = await addMinutesToTodaySession(30, new Date(), correctedSplit);
    expect(second.id).not.toBe(first.id);
    expect(await db.plannerSessions.count()).toBe(1);
  });

  it('deleteTodayPlannerSession is a no-op when nothing is planned yet today', async () => {
    await expect(deleteTodayPlannerSession()).resolves.toBeUndefined();
  });

  it('doing the work in place does not settle its session step — that is Mark complete\'s job only (2026-08-27)', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);

    const session = await addMinutesToTodaySession(30);
    const vocabStep = session.steps.find((step) => step.targetKind === 'vocabulary_review');
    expect(vocabStep!.sentenceId).toBe(sentence.id);

    // Confirming vocabulary records the confirmation but leaves the step alone.
    await confirmSentenceVocabulary(sentence.id, []);
    let updated = await getPlannerSession(session.id);
    expect(updated!.steps.find((step) => step.id === vocabStep!.id)!.status).not.toBe('completed');

    // Only an explicit Mark complete settles it.
    await updatePlannerSessionStep(session.id, vocabStep!.id, { status: 'completed' });
    updated = await getPlannerSession(session.id);
    expect(updated!.steps.find((step) => step.id === vocabStep!.id)!.status).toBe('completed');

    // Next day: the now-confirmed, ready sentence yields a continue_book step,
    // and finishing the sentence likewise does not settle it on its own.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const nextDaySession = await addMinutesToTodaySession(30, tomorrow);
    const continueStep = nextDaySession.steps.find((step) => step.targetKind === 'continue_book');
    expect(continueStep!.sentenceId).toBe(sentence.id);

    await setBookSentenceStatus(book.id, sentence.id, 'complete');
    updated = await getPlannerSession(nextDaySession.id);
    expect(updated!.steps.find((step) => step.id === continueStep!.id)!.status).not.toBe('completed');
  });
});
