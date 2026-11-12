import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addMinutesToTodaySession,
  addSentencesToBook,
  computeLearningBalance,
  confirmSentenceVocabulary,
  countAttemptsForSentences,
  createBook,
  deleteTodayPlannerSession,
  endPlannerSessionEarly,
  ensureStudyItem,
  getDb,
  getSentenceShadowingReadiness,
  getSessionPlannerInput,
  getTodayPlannerSession,
  logPhraseShadow,
  logSentenceLearningEvent,
  planRecommendedSession,
  setBookSuspended,
  recordReview,
  saveAttempt,
  setBookSentenceStatus,
  updatePlannerSessionStep,
  requestFreshTry,
  createBookChapter,
  assignBookSentencesToChapter,
  setChapterSuspended,
  updateSettings,
} from '../src/db/repository';
import { shadowAttemptSummary } from '../src/lib/sessionPlanner';
import type { Sentence, VocabularySelection } from '../src/domain/types';
import { createId } from '../src/lib/ids';

function makeSelection(overrides: Partial<VocabularySelection> = {}): VocabularySelection {
  return {
    id: createId('vocab_selection'),
    surface: '皆',
    start: 0,
    end: 1,
    expression: '皆',
    reading: 'みな',
    source: 'manual',
    ...overrides,
  };
}

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
  beforeEach(async () => {
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

  it('a suspended book drops out of explore candidates and its due cards out of the review pool', async () => {
    const book = await createBook({ title: 'Too Hard' });
    const db = getDb();
    const sentences = [makeSentence(), makeSentence()];
    await db.sentences.bulkPut(sentences);
    await addSentencesToBook(
      book.id,
      sentences.map((s) => s.id),
    );
    // A due sentence card from this book.
    const card = await ensureStudyItem('sentence', sentences[0]!.id, 'reading_in_context');

    const before = await getSessionPlannerInput(60);
    expect(before.exploreCandidates.some((c) => c.bookId === book.id)).toBe(true);
    expect(before.retainDue.some((d) => d.studyItemId === card.id)).toBe(true);

    await setBookSuspended(book.id, true);

    const after = await getSessionPlannerInput(60);
    expect(after.exploreCandidates.some((c) => c.bookId === book.id)).toBe(false);
    expect(after.retainDue.some((d) => d.studyItemId === card.id)).toBe(false);
  });

  it('among caught-up books, an easier (higher known-vocabulary coverage) book edges out a harder one opened more recently ("Ready to read" step 3)', async () => {
    const db = getDb();

    const easyBook = await createBook({ title: 'Older Easy' });
    const easySentence = makeSentence({ japanese: '猫が寝ています。' });
    await db.sentences.put(easySentence);
    await addSentencesToBook(easyBook.id, [easySentence.id]);
    await confirmSentenceVocabulary(easySentence.id, [
      makeSelection({ surface: '猫', expression: '猫', reading: 'ねこ' }),
    ]);
    const easyWord = await db.vocabularyItems
      .where('[expression+reading]')
      .equals(['猫', 'ねこ'])
      .first();
    const easyStudyItem = await ensureStudyItem('vocabularyItem', easyWord!.id, 'reading_retrieval');
    // 100% known.
    await db.studyItems.update(easyStudyItem.id, {
      fsrsState: { ...easyStudyItem.fsrsState, state: 'review' },
    });

    // Created after easyBook, so recency alone would rank this first.
    const hardBook = await createBook({ title: 'Recent Hard' });
    const hardSentence = makeSentence({ japanese: '犬が走ります。' });
    await db.sentences.put(hardSentence);
    await addSentencesToBook(hardBook.id, [hardSentence.id]);
    await confirmSentenceVocabulary(hardSentence.id, [
      makeSelection({ surface: '犬', expression: '犬', reading: 'いぬ' }),
    ]);
    const hardWord = await db.vocabularyItems
      .where('[expression+reading]')
      .equals(['犬', 'いぬ'])
      .first();
    // Left at 'new' — 0% known.
    await ensureStudyItem('vocabularyItem', hardWord!.id, 'reading_retrieval');

    const input = await getSessionPlannerInput(60);
    const ids = input.exploreCandidates.map((c) => c.bookId);
    expect(ids.indexOf(easyBook.id)).toBeLessThan(ids.indexOf(hardBook.id));
  });

  it('tracks step completion/skip explicitly, and only completes the session once every step is settled', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);
    // A brand-new StudyItem is immediately due, giving a second (retain) step.
    await ensureStudyItem('sentence', sentence.id, 'reading_in_context');

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

  it('game breaks persist gameId, and a later top-up rotates to games not already in today\'s session', async () => {
    const book = await createBook({ title: 'Games' });
    const db = getDb();
    const sentences = Array.from({ length: 12 }, () => makeSentence());
    await db.sentences.bulkPut(sentences);
    await addSentencesToBook(book.id, sentences.map((s) => s.id));
    const games = [
      { gameId: 'word-detective', title: 'Word Detective', skill: 'word readings' },
      { gameId: 'particle-puzzle', title: 'Particle Puzzle', skill: 'particles' },
    ];

    const first = await addMinutesToTodaySession(20, new Date(), undefined, games);
    const firstGames = first.steps.filter((step) => step.targetKind === 'game');
    expect(firstGames.map((step) => step.gameId)).toEqual(['word-detective']);
    expect(first.targetMinutes).toBe(20);

    const second = await addMinutesToTodaySession(20, new Date(), undefined, games);
    const secondGames = second.steps.filter((step) => step.targetKind === 'game');
    expect(secondGames.map((step) => step.gameId)).toEqual(['word-detective', 'particle-puzzle']);
    expect(second.targetMinutes).toBe(40);
  });

  it('sentence-first planning drafts a lesson at zero vocabulary, and settling it confirms nothing', async () => {
    const book = await createBook({ title: 'Lesson Book' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);

    const session = await addMinutesToTodaySession(30);
    const lesson = session.steps.find((step) => step.targetKind === 'sentence_learning');
    expect(lesson?.sentenceId).toBe(sentence.id);
    expect(session.steps.some((step) => step.targetKind === 'vocabulary_review')).toBe(false);

    await updatePlannerSessionStep(session.id, lesson!.id, { status: 'completed' });
    const analysis = await db.analyses.get(sentence.id);
    expect(analysis?.vocabularyReviewStatus).not.toBe('confirmed');
    const membership = await db.bookSentences
      .where('[bookId+sentenceId]')
      .equals([book.id, sentence.id])
      .first();
    expect(membership?.status).toBe('unstarted');
    expect(await db.reviews.count()).toBe(0);
    expect(await db.studyItems.count()).toBe(0);
  });

  it('sentence-first: a sentence walked through on an earlier day comes back as a revisit, not a new lesson', async () => {
    const book = await createBook({ title: 'Revisit Book' });
    const db = getDb();
    const walked = makeSentence();
    const fresh = makeSentence();
    await db.sentences.bulkPut([walked, fresh]);
    await addSentencesToBook(book.id, [walked.id, fresh.id]);
    await db.sentenceLearningEvents.put({
      id: createId('sle'),
      sentenceId: walked.id,
      bookId: book.id,
      action: 'walkthrough_completed',
      timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    } as never);

    const session = await addMinutesToTodaySession(30);
    const lessons = session.steps.filter((step) => step.targetKind === 'sentence_learning');
    expect(lessons.map((step) => step.sentenceId)).toEqual([walked.id, fresh.id]);
    expect(lessons[0]!.label).toMatch(/^Fresh try/);
  });

  it('sentence-first: due fresh tries in a suspended episode never use up the per-book cap, and the cap lifts when no new lessons wait', async () => {
    const book = await createBook({ title: 'Episodes' });
    const db = getDb();
    const shelved = [makeSentence(), makeSentence(), makeSentence()];
    const open = [makeSentence(), makeSentence(), makeSentence(), makeSentence()];
    await db.sentences.bulkPut([...shelved, ...open]);
    await addSentencesToBook(book.id, [...shelved, ...open].map((sentence) => sentence.id));
    const shelvedChapter = await createBookChapter(book.id, 'Shelved');
    const openChapter = await createBookChapter(book.id, 'Open');
    await assignBookSentencesToChapter(book.id, shelved.map((sentence) => sentence.id), shelvedChapter.id);
    await assignBookSentencesToChapter(book.id, open.map((sentence) => sentence.id), openChapter.id);
    await setChapterSuspended(book.id, shelvedChapter.id, true);
    // Shelved sentences were walked first (oldest), so they head the due list.
    const walkedAt = (daysAgo: number) => new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    await db.sentenceLearningEvents.bulkPut(
      [...shelved, ...open].map((sentence, index) => ({
        id: createId('sle'),
        sentenceId: sentence.id,
        bookId: book.id,
        action: 'walkthrough_completed',
        timestamp: walkedAt(30 - index),
      })) as never,
    );

    const session = await addMinutesToTodaySession(60);
    const lessons = session.steps.filter((step) => step.targetKind === 'sentence_learning');
    expect(lessons.map((step) => step.sentenceId).sort()).toEqual(open.map((sentence) => sentence.id).sort());
    expect(lessons.every((step) => step.revisit)).toBe(true);
  });

  it('sentence-first: a review-card fresh-try request jumps the spacing wait until an attempt is logged', async () => {
    const book = await createBook({ title: 'Request Book' });
    const db = getDb();
    const walked = makeSentence();
    await db.sentences.put(walked);
    await addSentencesToBook(book.id, [walked.id]);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const base = { sentenceId: walked.id, bookId: book.id, timestamp: yesterday } as never;
    await db.sentenceLearningEvents.bulkPut([
      { ...(base as object), id: createId('sle'), action: 'walkthrough_completed' },
      { ...(base as object), id: createId('sle'), action: 'expression_attempt', outcome: 'needed_help' },
    ] as never);

    expect(await requestFreshTry(makeSentence().id)).toBe('not_walked');
    const before = await addMinutesToTodaySession(30);
    expect(before.steps.filter((step) => step.targetKind === 'sentence_learning' && !step.readCheck)).toEqual([]);
    await deleteTodayPlannerSession();

    expect(await requestFreshTry(walked.id)).toBe('queued');
    const after = await addMinutesToTodaySession(30);
    const lesson = after.steps.find((step) => step.targetKind === 'sentence_learning' && !step.readCheck);
    expect(lesson?.sentenceId).toBe(walked.id);
    expect(lesson?.revisit).toBe(true);
    await deleteTodayPlannerSession();

    await db.sentenceLearningEvents.put({
      id: createId('sle'),
      sentenceId: walked.id,
      bookId: book.id,
      action: 'expression_attempt',
      outcome: 'needed_help',
      timestamp: new Date(Date.now() + 1000).toISOString(),
    } as never);
    const done = await addMinutesToTodaySession(30);
    expect(done.steps.some((step) => step.targetKind === 'sentence_learning' && !step.readCheck)).toBe(false);
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
    const studyItem = await ensureStudyItem('sentence', sentence.id, 'reading_in_context');
    await recordReview({ studyItemId: studyItem.id, rating: 'good' });

    const balance = await computeLearningBalance();
    const review = balance.find((entry) => entry.bucket === 'review')!;
    const grammar = balance.find((entry) => entry.bucket === 'grammar')!;
    expect(review.neglectScore).toBeLessThan(grammar.neglectScore);
    expect(grammar.daysSinceLast).toBeNull();
  });

  it('learning balance counts only reviews inside the window, and measures recency from the newest one', async () => {
    const db = getDb();
    const hours = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();
    const inWindow = Array.from({ length: 120 }, (_, i) => ({
      id: `in-${i}`, studyItemId: 'item-1', rating: 'good' as const, timestamp: hours(24 + i), // 1 to 6 days ago
    }));
    const outside = Array.from({ length: 40 }, (_, i) => ({
      id: `old-${i}`, studyItemId: 'item-1', rating: 'good' as const, timestamp: hours(24 * 30 + i), // 30 days ago
    }));
    await db.reviews.bulkPut([...inWindow, ...outside]);

    const review = (await computeLearningBalance()).find((entry) => entry.bucket === 'review')!;
    expect(review.count).toBe(120);
    expect(review.daysSinceLast).toBeCloseTo(1, 1);
  });

  it('does not re-offer sentences already shadowed today after the session is cleared', async () => {
    const book = await createBook({ title: 'Shadow Twice' });
    const db = getDb();
    const sentences = [makeSentence(), makeSentence()];
    await db.sentences.bulkPut(sentences);
    await addSentencesToBook(book.id, sentences.map((s) => s.id));
    for (const sentence of sentences) {
      await setBookSentenceStatus(book.id, sentence.id, 'in_progress');
      await confirmSentenceVocabulary(sentence.id, []);
      await db.sentenceAudio.add({
        id: `audio-${sentence.id}`,
        sentenceId: sentence.id,
        sourceId: 'source-1',
        sourceSentenceId: `src-${sentence.id}`,
        sourceTitle: 'Test Source',
        mimeType: 'audio/mp3',
        durationMs: 3000,
        startMs: 0,
        endMs: 3000,
        blob: new Blob(['fake audio bytes'], { type: 'audio/mp3' }),
        importedAt: new Date().toISOString(),
      });
    }
    await updateSettings({ sentenceShadowingPaused: true });

    const first = await planRecommendedSession(60);
    const firstShadow = first.steps.filter((step) => step.targetKind === 'shadow').map((step) => step.sentenceId);
    expect(new Set(firstShadow)).toEqual(new Set(sentences.map((s) => s.id)));

    // A phrase pass logs no attempt row, so attempt counts alone cannot tell it was done.
    const done = firstShadow[0]!;
    await logPhraseShadow({
      bookId: book.id,
      sentenceId: done,
      sentenceAudioId: `audio-${done}`,
      clipDurationMs: 3000,
      range: { startMs: 500, endMs: 1500 },
      outcome: 'got_it',
    });
    await deleteTodayPlannerSession();

    // Candidate order, not step order: the plan groups a shadow step with its sentence's lesson.
    const order = (await getSessionPlannerInput(60)).shadowCandidates.map((candidate) => candidate.sentenceId);
    expect(order[0]).not.toBe(done);
    expect(order).toContain(done);
  });

  it('shadows a walked-through sentence even when its book membership is still unstarted', async () => {
    const book = await createBook({ title: 'Walked Through' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);
    await db.sentenceAudio.add({
      id: 'audio-shadow-wt',
      sentenceId: sentence.id,
      sourceId: 'source-1',
      sourceSentenceId: 'src-sent-wt',
      sourceTitle: 'Test Source',
      mimeType: 'audio/mp3',
      durationMs: 1500,
      startMs: 0,
      endMs: 1500,
      blob: new Blob(['fake audio bytes'], { type: 'audio/mp3' }),
      importedAt: new Date().toISOString(),
    });
    await confirmSentenceVocabulary(sentence.id, []);
    const before = await getSessionPlannerInput(60);
    expect(before.shadowCandidates).toHaveLength(0);

    await logSentenceLearningEvent({ sentenceId: sentence.id, bookId: book.id, action: 'walkthrough_completed' });
    const after = await getSessionPlannerInput(60);
    expect(after.shadowCandidates.map((candidate) => candidate.sentenceId)).toEqual([sentence.id]);
  });

  it('quiet mode also withholds due pitch_accent_production items from the review pool (recording required)', async () => {
    const sentence = makeSentence();
    const db = getDb();
    await db.sentences.put(sentence);
    const card = await ensureStudyItem('sentence', sentence.id, 'pitch_accent_production');

    const before = await getSessionPlannerInput(60);
    expect(before.practiceDue.some((d) => d.studyItemId === card.id)).toBe(true);

    await updateSettings({ quietMode: true });
    const quiet = await getSessionPlannerInput(60);
    expect(quiet.practiceDue.some((d) => d.studyItemId === card.id)).toBe(false);

    await updateSettings({ quietMode: false });
    const loud = await getSessionPlannerInput(60);
    expect(loud.practiceDue.some((d) => d.studyItemId === card.id)).toBe(true);
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

  it('countAttemptsForSentences tallies recorded attempts so a shadow step subtitle can stay current', async () => {
    const db = getDb();
    const s1 = makeSentence();
    const s2 = makeSentence();
    await db.sentences.bulkPut([s1, s2]);

    expect(await countAttemptsForSentences([])).toEqual(new Map());
    expect(await countAttemptsForSentences([s1.id, s2.id])).toEqual(new Map());

    const blob = new Blob(['x'], { type: 'audio/webm' });
    await saveAttempt({ sentenceId: s1.id, blob, mimeType: 'audio/webm', durationMs: 100 });
    await saveAttempt({ sentenceId: s1.id, blob, mimeType: 'audio/webm', durationMs: 100, practiceStage: 'final' });
    await saveAttempt({ sentenceId: s2.id, blob, mimeType: 'audio/webm', durationMs: 100 });

    const counts = await countAttemptsForSentences([s1.id, s2.id]);
    expect(counts.get(s1.id)).toBe(2);
    expect(counts.get(s2.id)).toBe(1);
    expect(shadowAttemptSummary(counts.get(s1.id) ?? 0)).toBe('Shadowed 2x so far');
    expect(shadowAttemptSummary(0)).toBe('Not shadowed yet');
  });

  it('shadowing readiness needs only the sentence being introduced — no confirmed vocabulary or vocabulary-card reviews required', async () => {
    const book = await createBook({ title: 'Led Shadow' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);

    // Not introduced (unstarted, no walkthrough, no card).
    expect((await getSentenceShadowingReadiness([sentence.id])).get(sentence.id)).toBe(false);

    // A completed walkthrough introduces it.
    await logSentenceLearningEvent({
      visitId: 'visit-1',
      action: 'walkthrough_completed',
      bookId: book.id,
      sentenceId: sentence.id,
    });
    expect((await getSentenceShadowingReadiness([sentence.id])).get(sentence.id)).toBe(true);
  });

});

describe('retired word & grammar drills', () => {
  beforeEach(async () => {
    resetDbForTests(`session-planner-${createId('db')}`);
  });

  it('leaves vocabulary due items out of the planner input and keeps sentence cards', async () => {
    const vocab = await ensureStudyItem('vocabularyItem', 'v1', 'reading_retrieval');
    const sent = await ensureStudyItem('sentence', 's1', 'reading_in_context');
    const past = new Date(Date.now() - 86400000).toISOString();
    for (const item of [vocab, sent]) {
      await getDb().studyItems.update(item.id, { fsrsState: { ...item.fsrsState, due: past } });
    }
    const input = await getSessionPlannerInput(30, new Date());
    const ids = [...input.retainDue, ...input.practiceDue].map((item) => item.studyItemId);
    expect(ids).not.toContain(vocab.id);
    expect(ids).toContain(sent.id);
    // The retired card itself is untouched.
    expect(await getDb().studyItems.get(vocab.id)).toBeTruthy();
  });
});
