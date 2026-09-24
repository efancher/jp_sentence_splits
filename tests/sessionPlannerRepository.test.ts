import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addMinutesToTodaySession,
  addSentencesToBook,
  computeLearningBalance,
  confirmSentenceVocabulary,
  countAttemptsForSentences,
  countNewVocabularyCardBacklog,
  createBook,
  deleteTodayPlannerSession,
  endPlannerSessionEarly,
  ensureStudyItem,
  getDb,
  getPlannerSession,
  getSessionPlannerInput,
  getTodayPlannerSession,
  planRecommendedSession,
  setBookSuspended,
  recordReview,
  saveAttempt,
  setBookSentenceStatus,
  setSentenceGrammarReviewStatus,
  updatePlannerSessionStep,
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

  it('counts confirmed-but-never-introduced words as the new-card backlog, and the planner reserves review minutes for them', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const book = await createBook({ title: 'Old Book' });
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);

    // Three confirmed words (surface-form-bearing links); one already has a
    // study item, so only two are backlog.
    for (let i = 0; i < 3; i += 1) {
      await db.vocabularyItems.put({
        id: `vi_${i}`,
        expression: `語${i}`,
        reading: `ご${i}`,
        meaning: 'word',
        createdAt: now,
        updatedAt: now,
      });
      await db.sentenceVocabulary.put({
        id: `sv_${i}`,
        sentenceId: sentence.id,
        vocabularyItemId: `vi_${i}`,
        surfaceForm: `語${i}`,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ensureStudyItem('vocabularyItem', 'vi_0', 'reading_retrieval');

    expect(await countNewVocabularyCardBacklog()).toBe(2);

    const recommended = await planRecommendedSession(60);
    const reviewStep = recommended.steps.find((step) => step.targetKind === 'review');
    expect(reviewStep).toBeDefined();
    expect(reviewStep!.targetCount).toBe(2);
    expect(recommended.allocation.review).toBeGreaterThan(0);
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
    const studyItem = await ensureStudyItem('sentence', sentence.id, 'reading_in_context');
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

    // Quiet mode withholds every shadow candidate — the step disappears and
    // the plan says why. Turning it back off restores it (nothing consumed).
    await updateSettings({ quietMode: true });
    const quiet = await planRecommendedSession(60);
    expect(quiet.steps.some((step) => step.targetKind === 'shadow')).toBe(false);
    expect(quiet.explanation.some((line) => line.toLowerCase().includes('quiet mode'))).toBe(true);

    await updateSettings({ quietMode: false });
    const loud = await planRecommendedSession(60);
    expect(loud.steps.some((step) => step.targetKind === 'shadow')).toBe(true);
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

  it('withholds continue_book until a confirmed word\'s reading/meaning card has been reviewed at least once — pitch-only reps do not count (user report, 2026-09-16)', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);

    await confirmSentenceVocabulary(sentence.id, [makeSelection()]);
    const link = await db.sentenceVocabulary.where('sentenceId').equals(sentence.id).first();
    const vocabularyItemId = link!.vocabularyItemId;

    // Confirmed but never reviewed at all (the "皆" case): withheld.
    const beforeAnyReview = await planRecommendedSession(60);
    expect(beforeAnyReview.steps.some((step) => step.targetKind === 'continue_book')).toBe(false);

    // A pitch_accent rep alone doesn't count — pitch practice isn't reading/meaning recall.
    const pitchItem = await ensureStudyItem('vocabularyItem', vocabularyItemId, 'pitch_accent');
    await recordReview({ studyItemId: pitchItem.id, rating: 'good' });
    const afterPitchOnly = await planRecommendedSession(60);
    expect(afterPitchOnly.steps.some((step) => step.targetKind === 'continue_book')).toBe(false);

    // One reading/meaning rep unlocks it, even far short of FSRS proficiency.
    const readingItem = await ensureStudyItem('vocabularyItem', vocabularyItemId, 'reading_retrieval');
    await recordReview({ studyItemId: readingItem.id, rating: 'good' });
    const afterReadingRep = await planRecommendedSession(60);
    const continueStep = afterReadingRep.steps.find((step) => step.targetKind === 'continue_book');
    expect(continueStep).toBeDefined();
    expect(continueStep!.sentenceId).toBe(sentence.id);
  });

  it('withholds a shadow step unless a confirmed word is both reading-proficient and pitch-proficient — either alone is not enough (2026-09-16)', async () => {
    const book = await createBook({ title: 'Shadow Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);
    await setBookSentenceStatus(book.id, sentence.id, 'in_progress');
    await db.sentenceAudio.add({
      id: 'audio-shadow-2',
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
    await confirmSentenceVocabulary(sentence.id, [makeSelection()]);
    const link = await db.sentenceVocabulary.where('sentenceId').equals(sentence.id).first();
    const vocabularyItemId = link!.vocabularyItemId;
    // Dictionary-pitch-eligible (getSentenceShadowingReadiness exempts words
    // with no pitchAccentPositions from the pitch requirement entirely, so
    // without this the "reading only" step below would already pass).
    await db.vocabularyItems.update(vocabularyItemId, { pitchAccentPositions: [1] });

    // Push a study item to FSRS "review" (proficient) with a few spaced "good" ratings.
    const advanceToProficient = async (activityType: string) => {
      const item = await ensureStudyItem('vocabularyItem', vocabularyItemId, activityType);
      let studyItemId = item.id;
      for (let i = 0; i < 3; i += 1) {
        const day = new Date(Date.now() + i * 30 * 24 * 60 * 60 * 1000);
        const result = await recordReview({ studyItemId, rating: 'good', now: day });
        studyItemId = result.studyItem.id;
      }
    };

    // Neither reading nor pitch proficient yet: withheld.
    const beforeEither = await planRecommendedSession(60);
    expect(beforeEither.steps.some((step) => step.targetKind === 'shadow')).toBe(false);

    // Reading proficient, pitch still untouched: still withheld.
    await advanceToProficient('reading_retrieval');
    const readingOnly = await planRecommendedSession(60);
    expect(readingOnly.steps.some((step) => step.targetKind === 'shadow')).toBe(false);

    // Both proficient: shadow becomes eligible.
    await advanceToProficient('pitch_accent');
    const both = await planRecommendedSession(60);
    const shadowStep = both.steps.find((step) => step.targetKind === 'shadow');
    expect(shadowStep).toBeDefined();
    expect(shadowStep!.sentenceId).toBe(sentence.id);
  });

  it('does not withhold shadowing on pitch for a word with no dictionary pitch data — it could never seed a pitch_accent card (2026-09-16)', async () => {
    const book = await createBook({ title: 'Shadow Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);
    await setBookSentenceStatus(book.id, sentence.id, 'in_progress');
    await db.sentenceAudio.add({
      id: 'audio-shadow-3',
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
    await confirmSentenceVocabulary(sentence.id, [makeSelection()]);
    const link = await db.sentenceVocabulary.where('sentenceId').equals(sentence.id).first();
    const vocabularyItemId = link!.vocabularyItemId;
    // No pitchAccentPositions set — this word is not pitch-eligible at all.

    const item = await ensureStudyItem('vocabularyItem', vocabularyItemId, 'reading_retrieval');
    let studyItemId = item.id;
    for (let i = 0; i < 3; i += 1) {
      const day = new Date(Date.now() + i * 30 * 24 * 60 * 60 * 1000);
      const result = await recordReview({ studyItemId, rating: 'good', now: day });
      studyItemId = result.studyItem.id;
    }

    const session = await planRecommendedSession(60);
    const shadowStep = session.steps.find((step) => step.targetKind === 'shadow');
    expect(shadowStep).toBeDefined();
    expect(shadowStep!.sentenceId).toBe(sentence.id);
  });

  it('surfaces a worked-through, vocab-ready sentence as a grammar_noticing step, gated on vocab and cleared once grammar is marked reviewed', async () => {
    const book = await createBook({ title: 'Notice Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);
    await setBookSentenceStatus(book.id, sentence.id, 'complete');

    // Worked through, but vocab not confirmed yet → no nudge.
    const beforeConfirm = await planRecommendedSession(60);
    expect(beforeConfirm.steps.some((step) => step.targetKind === 'grammar_noticing')).toBe(false);

    await confirmSentenceVocabulary(sentence.id, []);
    const afterConfirm = await planRecommendedSession(60);
    const noticeStep = afterConfirm.steps.find((step) => step.targetKind === 'grammar_noticing');
    expect(noticeStep).toBeDefined();
    expect(noticeStep!.sentenceId).toBe(sentence.id);
    expect(noticeStep!.bucket).toBe('grammar');

    await setSentenceGrammarReviewStatus(sentence.id, 'confirmed');
    const afterReview = await planRecommendedSession(60);
    expect(afterReview.steps.some((step) => step.targetKind === 'grammar_noticing')).toBe(false);
  });

  it('batches several worked-through sentences into one grammar_noticing step, and completing it confirms every sentence still open', async () => {
    const book = await createBook({ title: 'Notice Us' });
    const db = getDb();
    const sentences = [makeSentence(), makeSentence(), makeSentence()];
    await db.sentences.bulkPut(sentences);
    await addSentencesToBook(
      book.id,
      sentences.map((s) => s.id),
    );
    for (const sentence of sentences) {
      await setBookSentenceStatus(book.id, sentence.id, 'complete');
      await confirmSentenceVocabulary(sentence.id, []);
    }

    const session = await addMinutesToTodaySession(60);
    const noticeSteps = session.steps.filter((step) => step.targetKind === 'grammar_noticing');
    expect(noticeSteps).toHaveLength(1);
    expect(new Set(noticeSteps[0]!.sentenceIds)).toEqual(new Set(sentences.map((s) => s.id)));

    // Learner closes one sentence in the flow itself, then marks the step done.
    await setSentenceGrammarReviewStatus(sentences[0]!.id, 'confirmed');
    await updatePlannerSessionStep(session.id, noticeSteps[0]!.id, { status: 'completed' });

    for (const sentence of sentences) {
      expect((await db.analyses.get(sentence.id))!.grammarReviewStatus).toBe('confirmed');
    }

    // All confirmed → no noticing step re-drafted the next day.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const day2 = await addMinutesToTodaySession(30, tomorrow);
    expect(day2.steps.some((step) => step.targetKind === 'grammar_noticing')).toBe(false);
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

  it('completing a glossing/grammar step advances its underlying marker so the planner stops re-proposing it (user report, 2026-09-06)', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);

    // Day 1: confirm vocab (no real items → immediately "ready") so the plan
    // offers the continue_book (structural analysis) step.
    await confirmSentenceVocabulary(sentence.id, []);
    const day1 = await addMinutesToTodaySession(30);
    const continueStep = day1.steps.find((step) => step.targetKind === 'continue_book');
    expect(continueStep!.sentenceId).toBe(sentence.id);

    // Completing it marks the book sentence complete...
    await updatePlannerSessionStep(day1.id, continueStep!.id, { status: 'completed' });
    const membership = await db.bookSentences
      .where('[bookId+sentenceId]')
      .equals([book.id, sentence.id])
      .first();
    expect(membership!.status).toBe('complete');

    // ...so day 2 no longer re-drafts the same continue_book step. The now
    // worked-through sentence surfaces as a grammar_noticing nudge instead.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const day2 = await addMinutesToTodaySession(30, tomorrow);
    expect(day2.steps.some((step) => step.targetKind === 'continue_book')).toBe(false);
    const noticeStep = day2.steps.find((step) => step.targetKind === 'grammar_noticing');
    expect(noticeStep!.sentenceId).toBe(sentence.id);

    // Completing the grammar-noticing step flips grammarReviewStatus, which is
    // what drops the sentence from that nudge's pool.
    await updatePlannerSessionStep(day2.id, noticeStep!.id, { status: 'completed' });
    expect((await db.analyses.get(sentence.id))!.grammarReviewStatus).toBe('confirmed');

    const dayAfter = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const day3 = await addMinutesToTodaySession(30, dayAfter);
    expect(day3.steps.some((step) => step.targetKind === 'grammar_noticing')).toBe(false);
  });

  it('skipping a glossing step does not advance its underlying marker', async () => {
    const book = await createBook({ title: 'Continue Me' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);

    const session = await addMinutesToTodaySession(30);
    const vocabStep = session.steps.find((step) => step.targetKind === 'vocabulary_review');
    await updatePlannerSessionStep(session.id, vocabStep!.id, { status: 'skipped' });
    const analysis = await db.analyses.get(sentence.id);
    expect(analysis?.vocabularyReviewStatus ?? 'unreviewed').not.toBe('confirmed');
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

  it('floats a sentence to the front of shadow candidates once its cloze card is missed twice in a row (cross-activity error routing)', async () => {
    const book = await createBook({ title: 'Shadow Cross-Activity' });
    const db = getDb();
    const missedSentence = makeSentence({ japanese: '彼は忙しいです。' });
    const otherSentence = makeSentence({ japanese: '猫が寝ています。' });
    await db.sentences.bulkPut([missedSentence, otherSentence]);
    await addSentencesToBook(book.id, [missedSentence.id, otherSentence.id]);
    for (const sentence of [missedSentence, otherSentence]) {
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
    }

    const beforeMiss = await getSessionPlannerInput(60);
    const beforeIds = beforeMiss.shadowCandidates.map((candidate) => candidate.sentenceId);
    expect(beforeIds).toContain(missedSentence.id);
    expect(beforeIds).toContain(otherSentence.id);

    const clozeItem = await ensureStudyItem('vocabularyItem', 'vocab-cross-activity', 'cloze');
    await recordReview({ studyItemId: clozeItem.id, rating: 'again', contextSentenceId: missedSentence.id });
    await recordReview({ studyItemId: clozeItem.id, rating: 'hard', contextSentenceId: missedSentence.id });

    const afterMiss = await getSessionPlannerInput(60);
    expect(afterMiss.shadowCandidates[0]?.sentenceId).toBe(missedSentence.id);
    expect(afterMiss.shadowCandidates[0]?.reason).toBe('Missed in review — reinforce with shadowing');
  });

  it('flags a grammar_completion item with crossActivityMissBoost once its sentence\'s sentence_transformation card is missed twice (cross-activity error routing)', async () => {
    const db = getDb();
    const sentence = makeSentence({ japanese: 'これはテストです。' });
    await db.sentences.put(sentence);

    const vocabLinkId = createId('sv');
    await db.sentenceVocabulary.put({
      id: vocabLinkId,
      sentenceId: sentence.id,
      vocabularyItemId: createId('vocab_item'),
      surfaceForm: 'テスト',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const transformationItem = await ensureStudyItem(
      'sentenceVocabulary',
      vocabLinkId,
      'sentence_transformation',
    );
    await recordReview({ studyItemId: transformationItem.id, rating: 'again', contextSentenceId: sentence.id });
    await recordReview({ studyItemId: transformationItem.id, rating: 'again', contextSentenceId: sentence.id });

    const patternId = createId('grammar_pattern');
    await db.grammarPatterns.put({
      id: patternId,
      canonicalName: '～です',
      normalizedKey: 'です',
      aliases: [],
      shortMeaning: 'copula',
      provenance: 'manual',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await db.sentenceGrammar.put({
      id: createId('sg'),
      sentenceId: sentence.id,
      grammarPatternId: patternId,
      confirmedByLearner: true,
      source: 'manual',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await ensureStudyItem('grammarPattern', patternId, 'grammar_completion');

    const input = await getSessionPlannerInput(60);
    const grammarInput = input.practiceDue.find((item) => item.subjectType === 'grammarPattern');
    expect(grammarInput?.crossActivityMissBoost).toBe(true);
  });
});
