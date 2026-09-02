import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import {
  confirmSentenceVocabulary,
  ensureGrammarPattern,
  ensureGrammarRelationship,
  ensureGrammarStudyItem,
  ensureSentenceGrammar,
  getDb,
  updateSettings,
} from '../src/db/repository';
import { ALIGNMENT_VERSION } from '../src/lib/analysisApi';
import { buildGrammarCompletionChoices } from '../src/lib/grammarPatterns';
import { createId } from '../src/lib/ids';
import { segmentIntoMorae } from '../src/lib/mora';
import { nativeAudioController } from '../src/lib/nativeAudio';
import { ReviewPage } from '../src/pages/ReviewPage';
import { withAppProviders } from '../src/test/providers';

/**
 * Mirrors ReviewPage's private PitchAccentCard: each choice button's
 * accessible name is its caption ("Stays high (no fall)" / "Falls after
 * mora N"); the textbook contour drawing next to it is aria-hidden.
 */
function expectedPitchAccentDrop(reading: string, position: number) {
  const morae = segmentIntoMorae(reading).map((unit) => unit.text);
  const correctPosition = Math.max(0, Math.min(position, morae.length));
  const caption = (at: number) =>
    at === 0 ? 'Stays high (no fall)' : `Falls after mora ${at}`;
  return { morae, correctPosition, label: caption(correctPosition), caption };
}

// Minimal fake <audio> so listening-card tests can drive playback/`onended`
// deterministically — mirrors tests/nativeAudio.test.ts's own MockAudio,
// since real jsdom HTMLMediaElement playback isn't reliable.
class MockAudio {
  static instances: MockAudio[] = [];
  src: string;
  playbackRate = 1;
  preservesPitch = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => undefined);
  pause = vi.fn();
  removeAttribute = vi.fn();
  load = vi.fn();

  constructor(src: string) {
    this.src = src;
    MockAudio.instances.push(this);
  }
}

async function seedBookWithSentence() {
  const db = getDb();
  const now = new Date().toISOString();
  await db.books.add({
    id: 'book-1',
    title: 'Test Book',
    archived: false,
    chapters: [],
    updatedAt: now,
  });
  await db.sentences.add({
    id: 'sent-1',
    normalizedKey: 'sent-1',
    japanese: '本を読みます。',
    readingOnly: '',
    inlineReading: '',
    translation: 'I read a book.',
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: now,
    updatedAt: now,
  });
  await db.bookSentences.add({
    id: 'bs-1',
    bookId: 'book-1',
    sentenceId: 'sent-1',
    position: 0,
    status: 'unstarted',
    addedAt: now,
  });
  // Vocabulary review confirmed with nothing linked, so Phase 7.11's
  // full-sentence gate doesn't interfere with tests that aren't about it.
  await db.analyses.add({
    sentenceId: 'sent-1',
    chunks: [],
    notes: '',
    status: 'empty',
    formatVersion: 2,
    vocabularyReviewStatus: 'confirmed',
    vocabularySelections: [],
    createdAt: now,
    updatedAt: now,
  });
}

/** Attaches a (fake-blob) reference recording to `sentenceId` — required for
 * listening and pitch-accent candidates. */
async function addReferenceAudio(sentenceId: string) {
  const db = getDb();
  await db.sentenceAudio.add({
    id: `audio-${sentenceId}`,
    sentenceId,
    sourceId: 'source-1',
    sourceSentenceId: `src-${sentenceId}`,
    sourceTitle: 'Test Source',
    mimeType: 'audio/mp3',
    durationMs: 1500,
    startMs: 0,
    endMs: 1500,
    blob: new Blob(['fake audio bytes'], { type: 'audio/mp3' }),
    importedAt: new Date().toISOString(),
  });
}

/**
 * Seeds far-future comprehension/reading_in_context study items for
 * `sentenceId` so those two unconditional activity types never occupy the
 * queue — used by tests that want to isolate a conditional card type
 * (vocabulary-target or listening) instead.
 */
async function suppressUnconditionalSentenceActivityTypes(sentenceId: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const farFutureFsrsState = {
    due: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    stability: 1,
    difficulty: 1,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 1,
    lapses: 0,
    state: 'review' as const,
  };
  for (const activityType of ['comprehension', 'reading_in_context']) {
    await db.studyItems.add({
      id: `si-${sentenceId}-${activityType}`,
      subjectType: 'sentence',
      subjectId: sentenceId,
      activityType,
      fsrsState: farFutureFsrsState,
      createdAt: now,
      updatedAt: now,
    });
  }
}

/**
 * Seeds far-future reading_retrieval/cloze/reading_production study items
 * for `vocabularyItemId` so those vocabulary-target activity types never
 * occupy the queue — used by the contrastive-pair test (Phase 7.7) to
 * isolate the confusion pair's own card instead of its two members'
 * individual review cards.
 */
async function suppressVocabularyActivityTypes(vocabularyItemId: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const farFutureFsrsState = {
    due: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    stability: 1,
    difficulty: 1,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 1,
    lapses: 0,
    state: 'review' as const,
  };
  for (const activityType of ['reading_retrieval', 'cloze', 'reading_production']) {
    await db.studyItems.add({
      id: `si-${vocabularyItemId}-${activityType}`,
      subjectType: 'vocabularyItem',
      subjectId: vocabularyItemId,
      activityType,
      fsrsState: farFutureFsrsState,
      createdAt: now,
      updatedAt: now,
    });
  }
}

/**
 * Seeds far-future `listening` (sentence) and `word_listening` (occurrence)
 * study items so neither audio card occupies the queue — used by the
 * pitch-accent tests, which now require reference audio (which also makes the
 * sentence/occurrence audio-eligible) but want to isolate the pitch card.
 */
async function suppressAudioCards(sentenceId: string, linkId: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const farFutureFsrsState = {
    due: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    stability: 1,
    difficulty: 1,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 1,
    lapses: 0,
    state: 'review' as const,
  };
  await db.studyItems.add({
    id: `si-${sentenceId}-listening`,
    subjectType: 'sentence',
    subjectId: sentenceId,
    activityType: 'listening',
    fsrsState: farFutureFsrsState,
    createdAt: now,
    updatedAt: now,
  });
  await db.studyItems.add({
    id: `si-${linkId}-word_listening`,
    subjectType: 'sentenceVocabulary',
    subjectId: linkId,
    activityType: 'word_listening',
    fsrsState: farFutureFsrsState,
    createdAt: now,
    updatedAt: now,
  });
}

function renderReviewPage(path: string, routePath: string) {
  return render(
    withAppProviders(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={<ReviewPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe('ReviewPage', () => {
  beforeEach(async () => {
    resetDbForTests(`review-page-${createId('db')}`);
    await ensureSettings();
  });

  // nativeAudioController is a module-level singleton, shared across every
  // test in this file — reset it so a still-"playing" state from one
  // listening-card test can't leak into the next and make its audio button
  // render as already-active.
  afterEach(() => nativeAudioController.stop());

  it('lazily seeds a study item and shows the sentence behind a reveal', async () => {
    await seedBookWithSentence();
    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    expect(await screen.findByText('本を読みます。')).toBeInTheDocument();
    expect(screen.queryByText('I read a book.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByText('I read a book.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Good' })).toBeInTheDocument();

    await waitFor(async () => {
      expect(await getDb().studyItems.count()).toBe(2);
    });
  });

  it('never lazily seeds a full-sentence card for a sentence whose vocabulary has never been reviewed (Phase 7.11)', async () => {
    // Deliberately not seedBookWithSentence() — that helper marks
    // vocabularyReviewStatus 'confirmed'. This sentence has no `analyses`
    // row at all, matching a freshly imported sentence nobody has opened
    // AnalyzePage for yet.
    const db = getDb();
    const now = new Date().toISOString();
    await db.books.add({ id: 'book-1', title: 'Test Book', archived: false, chapters: [], updatedAt: now });
    await db.sentences.add({
      id: 'sent-new',
      normalizedKey: 'sent-new',
      japanese: '新しい文です。',
      readingOnly: '',
      inlineReading: '',
      translation: 'This is a new sentence.',
      targetVocabulary: [],
      vocabularySuggestions: [],
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 0,
      importBatchIds: [],
      createdAt: now,
      updatedAt: now,
    });
    await db.bookSentences.add({
      id: 'bs-new',
      bookId: 'book-1',
      sentenceId: 'sent-new',
      position: 0,
      status: 'unstarted',
      addedAt: now,
    });

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('All caught up.');
    expect(screen.queryByText('新しい文です。')).not.toBeInTheDocument();
    expect(await db.studyItems.count()).toBe(0);
  });

  it('links "Why?" to the current card\'s study-item debug page (Phase 7.10)', async () => {
    await seedBookWithSentence();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('本を読みます。');
    const studyItem = await waitFor(async () => {
      const items = await getDb().studyItems.where('subjectId').equals('sent-1').toArray();
      const comprehensionItem = items.find((item) => item.activityType === 'comprehension');
      expect(comprehensionItem).toBeDefined();
      return comprehensionItem!;
    });
    expect(screen.getByRole('link', { name: 'Why?' })).toHaveAttribute(
      'href',
      `/study-items/${studyItem.id}`,
    );
  });

  it('rates a card, advances the queue, and records a review', async () => {
    await seedBookWithSentence();
    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('本を読みます。');
    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    await user.click(screen.getByRole('button', { name: 'Good' }));

    // Second study item (the other activity type) for the same sentence.
    await screen.findByText('本を読みます。');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reveal' })).toBeInTheDocument();
    });

    await waitFor(async () => {
      expect(await getDb().reviews.count()).toBe(1);
    });
  });

  it('does not double-record a review on a rapid double-click', async () => {
    await seedBookWithSentence();
    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('本を読みます。');
    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    const goodButton = screen.getByRole('button', { name: 'Good' });
    // Two synchronous, unawaited dispatches — simulates a double-tap
    // landing before the first handleRate() call's setSubmitting(true)
    // (and the resulting disabled state) has committed.
    fireEvent.click(goodButton);
    fireEvent.click(goodButton);

    await waitFor(async () => {
      expect(await getDb().reviews.count()).toBe(1);
    });
  });

  it('seeds only the missing activity type for a partially-seeded sentence', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    // Simulate an interrupted seed: comprehension exists (not due yet, so
    // it doesn't occupy the queue), reading_in_context doesn't exist at
    // all — the queue should still pick up the missing one on session
    // start, not skip the sentence forever.
    await db.studyItems.add({
      id: 'si-existing',
      subjectType: 'sentence',
      subjectId: 'sent-1',
      activityType: 'comprehension',
      fsrsState: {
        due: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        stability: 1,
        difficulty: 1,
        elapsedDays: 0,
        scheduledDays: 0,
        learningSteps: 0,
        reps: 1,
        lapses: 0,
        state: 'review',
      },
      createdAt: now,
      updatedAt: now,
    });

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('本を読みます。');
    await waitFor(async () => {
      const items = await db.studyItems
        .where('subjectId')
        .equals('sent-1')
        .toArray();
      expect(items.map((item) => item.activityType).sort()).toEqual(
        ['comprehension', 'reading_in_context'].sort(),
      );
    });
  });

  it('frames a reading_in_context card with its surrounding passage (docs/ROADMAP.md)', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    // Two more sentences around sent-1 in the same book.
    await db.sentences.bulkAdd([
      {
        id: 'sent-0',
        normalizedKey: 'sent-0',
        japanese: '朝ごはんを食べました。',
        readingOnly: '',
        inlineReading: '',
        translation: 'I ate breakfast.',
        targetVocabulary: [],
        vocabularySuggestions: [],
        sourceReferences: [],
        conflicts: [],
        firstOccurrenceIndex: 0,
        importBatchIds: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'sent-2',
        normalizedKey: 'sent-2',
        japanese: 'それから出かけました。',
        readingOnly: '',
        inlineReading: '',
        translation: 'Then I went out.',
        targetVocabulary: [],
        vocabularySuggestions: [],
        sourceReferences: [],
        conflicts: [],
        firstOccurrenceIndex: 0,
        importBatchIds: [],
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.bookSentences.bulkAdd([
      { id: 'bs-0', bookId: 'book-1', sentenceId: 'sent-0', position: -1, status: 'unstarted', addedAt: now },
      { id: 'bs-2', bookId: 'book-1', sentenceId: 'sent-2', position: 1, status: 'unstarted', addedAt: now },
    ]);
    // Keep plain comprehension out of the queue so the reading_in_context
    // card is the one under test.
    await db.studyItems.add({
      id: 'si-sent-1-comprehension',
      subjectType: 'sentence',
      subjectId: 'sent-1',
      activityType: 'comprehension',
      fsrsState: {
        due: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        stability: 1,
        difficulty: 1,
        elapsedDays: 0,
        scheduledDays: 0,
        learningSteps: 0,
        reps: 1,
        lapses: 0,
        state: 'review',
      },
      createdAt: now,
      updatedAt: now,
    });

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('本を読みます。');
    // Preceding sentence shown as context; caption names the book.
    expect(screen.getByText('朝ごはんを食べました。')).toBeInTheDocument();
    expect(screen.getByText(/In context · Test Book/)).toBeInTheDocument();
    // Following sentence only appears after reveal.
    expect(screen.queryByText('それから出かけました。')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByText('それから出かけました。')).toBeInTheDocument();
  });

  it('renders reading_retrieval, cloze, and reading_production cards for the same target word, each seeded once (Phase 7.2/7.3/7.9)', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    // Keep the two sentence-subject activity types out of the queue so only
    // the two vocabulary-subject cards seed/render in this test.
    await suppressUnconditionalSentenceActivityTypes('sent-1');

    await db.vocabularyItems.add({
      id: 'vocab-1',
      expression: '読む',
      reading: 'よむ',
      meaning: 'to read',
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-1',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-1',
      surfaceForm: '読みます',
      createdAt: now,
      updatedAt: now,
    });

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    // reading_retrieval card first — shows the word, hides the reading. The
    // surface form is inflected (読みます for 読む), so the card names the
    // dictionary form and labels the reveal accordingly.
    await screen.findByText('Reveal dictionary reading');
    expect(screen.getByText('読みます')).toBeInTheDocument();
    expect(screen.getByText('Dictionary form: 読む')).toBeInTheDocument();
    expect(screen.queryByText('よむ')).not.toBeInTheDocument();

    await waitFor(async () => {
      const seeded = await db.studyItems
        .where('subjectId')
        .equals('vocab-1')
        .toArray();
      expect(seeded.map((item) => item.activityType).sort()).toEqual([
        'cloze',
        'reading_production',
        'reading_retrieval',
      ]);
      expect(seeded.every((item) => item.subjectType === 'vocabularyItem')).toBe(true);
    });

    await user.click(screen.getByRole('button', { name: 'Reveal dictionary reading' }));
    expect(screen.getByText('よむ')).toBeInTheDocument();
    expect(screen.getByText('to read')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Good' }));

    // cloze card next — the word itself is blanked until reveal, with the
    // sentence translation shown as a hint (Phase 7.3 follow-up: a blank
    // alone under-constrains the answer, see docs/STATUS.md).
    await screen.findByText('Reveal word');
    expect(screen.queryByText('読みます')).not.toBeInTheDocument();
    expect(screen.getByText('_____')).toBeInTheDocument();
    expect(screen.getByText('I read a book.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reveal word' }));
    expect(screen.getByText('読みます')).toBeInTheDocument();
    expect(screen.getByText('よむ')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Good' }));

    // reading_production card last — types the reading, checks, then rates.
    await screen.findByText('Type the dictionary reading');
    await user.type(screen.getByLabelText('Type the dictionary reading'), 'よむ');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByText('✓ Correct')).toBeInTheDocument();
    expect(screen.getByText('よむ')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(3);
    });
    const productionReview = (await db.reviews.toArray()).find(
      (review) => review.responseRaw === 'よむ',
    );
    expect(productionReview?.expectedAnswer).toBe('よむ');
  });

  it('shows incorrect feedback for a wrong typed reading but still records the evidence and lets the learner self-rate (Phase 7.9)', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');

    await db.vocabularyItems.add({
      id: 'vocab-1',
      expression: '読む',
      reading: 'よむ',
      meaning: 'to read',
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-1',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-1',
      surfaceForm: '読みます',
      createdAt: now,
      updatedAt: now,
    });
    // Suppress reading_retrieval/cloze so only reading_production seeds.
    const farFutureFsrsState = {
      due: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      stability: 1,
      difficulty: 1,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
      state: 'review' as const,
    };
    for (const activityType of ['reading_retrieval', 'cloze']) {
      await db.studyItems.add({
        id: `si-vocab-1-${activityType}`,
        subjectType: 'vocabularyItem',
        subjectId: 'vocab-1',
        activityType,
        fsrsState: farFutureFsrsState,
        createdAt: now,
        updatedAt: now,
      });
    }

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('Type the dictionary reading');
    await user.type(screen.getByLabelText('Type the dictionary reading'), 'よみます');
    await user.click(screen.getByRole('button', { name: 'Check' }));

    expect(screen.getByText('✗ Not quite')).toBeInTheDocument();
    expect(screen.getByText('よむ')).toBeInTheDocument();
    // The learner's own answer is echoed back so they can see what went wrong.
    expect(screen.getByText('よみます')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Again' }));

    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
    const [review] = await db.reviews.toArray();
    expect(review?.rating).toBe('again');
    expect(review?.responseRaw).toBe('よみます');
    expect(review?.expectedAnswer).toBe('よむ');
  });

  it('accepts a romaji-typed reading when the learner has no Japanese IME (Phase 7.9 follow-up)', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');

    await db.vocabularyItems.add({
      id: 'vocab-1',
      expression: '読む',
      reading: 'よむ',
      meaning: 'to read',
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-1',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-1',
      surfaceForm: '読みます',
      createdAt: now,
      updatedAt: now,
    });
    const farFutureFsrsState = {
      due: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      stability: 1,
      difficulty: 1,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
      state: 'review' as const,
    };
    for (const activityType of ['reading_retrieval', 'cloze']) {
      await db.studyItems.add({
        id: `si-vocab-1-${activityType}`,
        subjectType: 'vocabularyItem',
        subjectId: 'vocab-1',
        activityType,
        fsrsState: farFutureFsrsState,
        createdAt: now,
        updatedAt: now,
      });
    }

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('Type the dictionary reading');
    await user.type(screen.getByLabelText('Type the dictionary reading'), 'yomu');
    await user.click(screen.getByRole('button', { name: 'Check' }));

    expect(screen.getByText('✓ Correct')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
    const [review] = await db.reviews.toArray();
    expect(review?.responseRaw).toBe('yomu');
    expect(review?.expectedAnswer).toBe('よむ');
  });

  const PAST_DUE_FSRS_STATE = {
    due: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    stability: 1,
    difficulty: 1,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 1,
    lapses: 0,
    state: 'review' as const,
  };

  it('lazily seeds a contextual conjugation card for the form the sentence uses, and records the review', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');

    await db.vocabularyItems.add({
      id: 'vocab-hanasu',
      expression: '話す',
      reading: 'はなす',
      meaning: 'to speak',
      partOfSpeech: 'v5s; vt',
      createdAt: now,
      updatedAt: now,
    });
    await db.sentences.update('sent-1', { japanese: '友達と話して、帰った。' });
    await db.sentenceVocabulary.add({
      id: 'sv-hanasu',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-hanasu',
      // Read here in te-form — that, not some hashed form, is what the card asks.
      surfaceForm: '話して',
      createdAt: now,
      updatedAt: now,
    });
    // Suppress reading_retrieval/cloze/reading_production so only the
    // conjugation card seeds for this word (and mark the word proficient so
    // the sentence passes the Phase 7.11 full-review gate).
    await suppressVocabularyActivityTypes('vocab-hanasu');

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('Produce: Te-form');
    expect(screen.getByText('Dictionary form: 話す')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Type the reading of the te-form'), 'はなして');
    await user.click(screen.getByRole('button', { name: 'Check' }));

    expect(screen.getByText('✓ Correct')).toBeInTheDocument();
    expect(screen.getByText('to speak')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
    const [review] = await db.reviews.toArray();
    expect(review?.responseRaw).toBe('はなして');
    expect(review?.expectedAnswer).toBe('はなして');

    const seeded = (await db.studyItems.toArray()).find(
      (item) => item.activityType === 'sentence_transformation',
    );
    expect(seeded?.subjectType).toBe('sentenceVocabulary');
    expect(seeded?.subjectId).toBe('sv-hanasu');
  });

  it('schedules one conjugation card per encounter — same verb, two sentences, two forms', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');

    await db.sentences.update('sent-1', { japanese: '友達と話して、帰った。' });
    await db.sentences.add({
      id: 'sent-2',
      normalizedKey: 'sent-2',
      japanese: '昨日、先生と話した。',
      readingOnly: '',
      inlineReading: '',
      translation: 'I spoke with the teacher yesterday.',
      targetVocabulary: [],
      vocabularySuggestions: [],
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 1,
      importBatchIds: [],
      createdAt: now,
      updatedAt: now,
    });
    await db.bookSentences.add({
      id: 'bs-2',
      bookId: 'book-1',
      sentenceId: 'sent-2',
      position: 1,
      status: 'unstarted',
      addedAt: now,
    });
    await db.analyses.add({
      sentenceId: 'sent-2',
      chunks: [],
      notes: '',
      status: 'empty',
      formatVersion: 2,
      vocabularyReviewStatus: 'confirmed',
      vocabularySelections: [],
      createdAt: now,
      updatedAt: now,
    });
    await suppressUnconditionalSentenceActivityTypes('sent-2');

    await db.vocabularyItems.add({
      id: 'vocab-hanasu',
      expression: '話す',
      reading: 'はなす',
      meaning: 'to speak',
      partOfSpeech: 'v5s; vt',
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.bulkAdd([
      {
        id: 'sv-hanasu-te',
        sentenceId: 'sent-1',
        vocabularyItemId: 'vocab-hanasu',
        surfaceForm: '話して',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'sv-hanasu-ta',
        sentenceId: 'sent-2',
        vocabularyItemId: 'vocab-hanasu',
        surfaceForm: '話した',
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await suppressVocabularyActivityTypes('vocab-hanasu');

    // Both occurrences pre-scheduled and due, so both surface without
    // fighting the lazy-seed new-card limiter.
    await db.studyItems.bulkAdd([
      {
        id: 'si-conj-te',
        subjectType: 'sentenceVocabulary',
        subjectId: 'sv-hanasu-te',
        activityType: 'sentence_transformation',
        fsrsState: PAST_DUE_FSRS_STATE,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'si-conj-ta',
        subjectType: 'sentenceVocabulary',
        subjectId: 'sv-hanasu-ta',
        activityType: 'sentence_transformation',
        fsrsState: { ...PAST_DUE_FSRS_STATE, due: new Date(Date.now() - 1000).toISOString() },
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    // Two separately-scheduled cards, one per encounter — each quizzing the
    // form that its own sentence used, not a shared/hashed one. Te-form is
    // due earlier, so it comes first; completing it reveals the past-form
    // card for the other sentence.
    await screen.findByText('Produce: Te-form');
    await user.type(screen.getByLabelText('Type the reading of the te-form'), 'はなして');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await user.click(screen.getByRole('button', { name: 'Good' }));

    await screen.findByText('Produce: Plain past');

    const conjugationItems = (await db.studyItems.toArray()).filter(
      (item) => item.activityType === 'sentence_transformation',
    );
    expect(conjugationItems.map((item) => item.subjectId).sort()).toEqual([
      'sv-hanasu-ta',
      'sv-hanasu-te',
    ]);
    expect(conjugationItems.every((item) => item.subjectType === 'sentenceVocabulary')).toBe(true);
  });

  it('gives no conjugation card to a non-conjugable word or a stacked/compound surface', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');

    await db.vocabularyItems.bulkAdd([
      {
        id: 'vocab-hon',
        expression: '本',
        reading: 'ほん',
        meaning: 'book',
        partOfSpeech: 'n',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'vocab-taberu',
        expression: '食べる',
        reading: 'たべる',
        meaning: 'to eat',
        partOfSpeech: 'v1',
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.sentenceVocabulary.bulkAdd([
      {
        id: 'sv-hon',
        sentenceId: 'sent-1',
        vocabularyItemId: 'vocab-hon',
        surfaceForm: '本',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'sv-taberu',
        sentenceId: 'sent-1',
        vocabularyItemId: 'vocab-taberu',
        // A stacked auxiliary chain — not a single form the engine produces.
        surfaceForm: '食べられなかった',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('Reveal reading');
    await waitFor(async () => {
      const studyItems = await db.studyItems.toArray();
      expect(studyItems.length).toBeGreaterThan(0);
      expect(
        studyItems.some((item) => item.activityType === 'sentence_transformation'),
      ).toBe(false);
    });
  });

  it('renders a pitch-accent card, grades the chosen pattern, and records the review', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await addReferenceAudio('sent-1');

    await db.vocabularyItems.add({
      id: 'vocab-hana',
      expression: '花',
      reading: 'はな',
      meaning: 'flower',
      partOfSpeech: 'n',
      pitchAccentPositions: [1],
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-hana',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-hana',
      surfaceForm: '花',
      createdAt: now,
      updatedAt: now,
    });
    await suppressVocabularyActivityTypes('vocab-hana');
    await suppressAudioCards('sent-1', 'sv-hana');

    // はな [1] → atamadaka, i.e. the drop is right after mora 1 (は).
    const { label, correctPosition } = expectedPitchAccentDrop('はな', 1);

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText(/Listen, then mark where it falls/);
    expect(screen.getByText('はな')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: label }));

    expect(screen.getByText('✓ Correct')).toBeInTheDocument();
    expect(screen.getByText('flower')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
    const [review] = await db.reviews.toArray();
    expect(review?.responseRaw).toBe(String(correctPosition));
    expect(review?.expectedAnswer).toBe(String(correctPosition));
    expect(review?.errorClassification).toBeUndefined();

    const studyItems = await db.studyItems
      .where('subjectId')
      .equals('vocab-hana')
      .toArray();
    const pitchAccentItem = studyItems.find((item) => item.activityType === 'pitch_accent');
    expect(pitchAccentItem?.subjectType).toBe('vocabularyItem');
  });

  it('classifies a wrong pitch-accent answer as pronunciation_difficulty', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await addReferenceAudio('sent-1');

    await db.vocabularyItems.add({
      id: 'vocab-hana2',
      expression: '花',
      reading: 'はな',
      meaning: 'flower',
      partOfSpeech: 'n',
      pitchAccentPositions: [1],
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-hana2',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-hana2',
      surfaceForm: '花',
      createdAt: now,
      updatedAt: now,
    });
    await suppressVocabularyActivityTypes('vocab-hana2');
    await suppressAudioCards('sent-1', 'sv-hana2');

    // Correct fall is after mora 1; click "no fall" (position 0) instead.
    const { correctPosition, caption } = expectedPitchAccentDrop('はな', 1);
    const wrongLabel = caption(0);

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText(/Listen, then mark where it falls/);
    await user.click(screen.getByRole('button', { name: wrongLabel }));

    expect(screen.getByText('✗ Not quite')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Again' }));

    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
    const [review] = await db.reviews.toArray();
    expect(review?.responseRaw).toBe('0');
    expect(review?.expectedAnswer).toBe(String(correctPosition));
    expect(review?.errorClassification).toBe('pronunciation_difficulty');
  });

  it('does not seed a pitch-accent card for a vocabulary item with no dictionary pitch-accent data', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');

    await db.vocabularyItems.add({
      id: 'vocab-mizu',
      expression: '水',
      reading: 'みず',
      meaning: 'water',
      partOfSpeech: 'n',
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-mizu',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-mizu',
      surfaceForm: '水',
      createdAt: now,
      updatedAt: now,
    });

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('Reveal reading');
    await waitFor(async () => {
      const studyItems = await db.studyItems
        .where('subjectId')
        .equals('vocab-mizu')
        .toArray();
      expect(studyItems.length).toBeGreaterThan(0);
      expect(studyItems.some((item) => item.activityType === 'pitch_accent')).toBe(false);
    });
  });

  it('does not seed a pitch-accent card when the sentence has no reference audio', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    // No addReferenceAudio('sent-1') — the word has dictionary pitch data but
    // there's no native recording to model the accent on the reveal.

    await db.vocabularyItems.add({
      id: 'vocab-hana-noaudio',
      expression: '花',
      reading: 'はな',
      meaning: 'flower',
      partOfSpeech: 'n',
      pitchAccentPositions: [1],
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-hana-noaudio',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-hana-noaudio',
      surfaceForm: '花',
      createdAt: now,
      updatedAt: now,
    });

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('Reveal reading');
    await waitFor(async () => {
      const studyItems = await db.studyItems
        .where('subjectId')
        .equals('vocab-hana-noaudio')
        .toArray();
      expect(studyItems.length).toBeGreaterThan(0);
      expect(studyItems.some((item) => item.activityType === 'pitch_accent')).toBe(false);
    });
  });

  it('does not seed a pitch-accent card when the word appears inflected in the sentence', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await addReferenceAudio('sent-1');
    // 速く (inflected) for dictionary form 速い — the looped native audio would
    // be 速く, whose morae/accent no longer match the 速い contour the choices
    // key off, so the card is unanswerable by ear.
    await db.sentences.update('sent-1', { japanese: '速く走ります。' });

    await db.vocabularyItems.add({
      id: 'vocab-hayai',
      expression: '速い',
      reading: 'はやい',
      meaning: 'fast',
      partOfSpeech: 'adj-i',
      pitchAccentPositions: [2],
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-hayai',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-hayai',
      surfaceForm: '速く',
      createdAt: now,
      updatedAt: now,
    });
    await suppressAudioCards('sent-1', 'sv-hayai');

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    // Inflected occurrence → reading_retrieval names the dictionary form.
    await screen.findByText('Reveal dictionary reading');
    await waitFor(async () => {
      const studyItems = await db.studyItems
        .where('subjectId')
        .equals('vocab-hayai')
        .toArray();
      expect(studyItems.length).toBeGreaterThan(0);
      expect(studyItems.some((item) => item.activityType === 'pitch_accent')).toBe(false);
    });
  });

  it('offers one fall-position choice per mora plus "no fall" for a 1-mora word', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await addReferenceAudio('sent-1');

    // 目 (め) — 1 mora: "no fall" and "falls after mora 1", nothing else.
    await db.vocabularyItems.add({
      id: 'vocab-me',
      expression: '目',
      reading: 'め',
      meaning: 'eye',
      partOfSpeech: 'n',
      pitchAccentPositions: [1],
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-me',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-me',
      surfaceForm: '目',
      createdAt: now,
      updatedAt: now,
    });
    await suppressVocabularyActivityTypes('vocab-me');
    await suppressAudioCards('sent-1', 'sv-me');

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText(/Listen, then mark where it falls/);
    expect(
      screen.getByRole('button', { name: 'Stays high (no fall)' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Falls after mora 1' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Falls after mora 2' }),
    ).not.toBeInTheDocument();
  });

  it('distinguishes two internal fall points (nakadaka) on a longer word and grades them separately', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await addReferenceAudio('sent-1');

    // あいさつ (挨拶) — 4 morae, dictionary accent [3]: falls after さ.
    // A fall after い (position 2) is also "nakadaka" but a different
    // contour — the old category card couldn't tell them apart.
    await db.vocabularyItems.add({
      id: 'vocab-aisatsu',
      expression: '挨拶',
      reading: 'あいさつ',
      meaning: 'greeting',
      partOfSpeech: 'n',
      pitchAccentPositions: [3],
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-aisatsu',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-aisatsu',
      surfaceForm: '挨拶',
      createdAt: now,
      updatedAt: now,
    });
    await suppressVocabularyActivityTypes('vocab-aisatsu');
    await suppressAudioCards('sent-1', 'sv-aisatsu');

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText(/Listen, then mark where it falls/);
    expect(screen.getByRole('button', { name: 'Falls after mora 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Falls after mora 3' })).toBeInTheDocument();

    // Pick the wrong internal fall point.
    await user.click(screen.getByRole('button', { name: 'Falls after mora 2' }));
    expect(screen.getByText('✗ Not quite')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Again' }));
    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
    const [review] = await db.reviews.toArray();
    expect(review?.responseRaw).toBe('2');
    expect(review?.expectedAnswer).toBe('3');
    expect(review?.errorClassification).toBe('pronunciation_difficulty');
  });

  it('renders a contrastive pair card for a confusion pair whose members are both vocabulary-target candidates (Phase 7.7)', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.books.add({
      id: 'book-1',
      title: 'Test Book',
      archived: false,
      chapters: [],
      updatedAt: now,
    });
    await db.sentences.bulkAdd([
      {
        id: 'sent-a',
        normalizedKey: 'sent-a',
        japanese: '電気が付きました。',
        readingOnly: '',
        inlineReading: '',
        translation: 'The light turned on.',
        targetVocabulary: [],
        vocabularySuggestions: [],
        sourceReferences: [],
        conflicts: [],
        firstOccurrenceIndex: 0,
        importBatchIds: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'sent-b',
        normalizedKey: 'sent-b',
        japanese: '電気を付けました。',
        readingOnly: '',
        inlineReading: '',
        translation: 'I turned on the light.',
        targetVocabulary: [],
        vocabularySuggestions: [],
        sourceReferences: [],
        conflicts: [],
        firstOccurrenceIndex: 1,
        importBatchIds: [],
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.bookSentences.bulkAdd([
      { id: 'bs-a', bookId: 'book-1', sentenceId: 'sent-a', position: 0, status: 'unstarted', addedAt: now },
      { id: 'bs-b', bookId: 'book-1', sentenceId: 'sent-b', position: 1, status: 'unstarted', addedAt: now },
    ]);
    await suppressUnconditionalSentenceActivityTypes('sent-a');
    await suppressUnconditionalSentenceActivityTypes('sent-b');

    await db.vocabularyItems.bulkAdd([
      {
        id: 'vocab-tsuku',
        expression: '付く',
        reading: 'つく',
        meaning: 'to turn on (intransitive)',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'vocab-tsukeru',
        expression: '付ける',
        reading: 'つける',
        meaning: 'to turn on (transitive)',
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.sentenceVocabulary.bulkAdd([
      {
        id: 'sv-a',
        sentenceId: 'sent-a',
        vocabularyItemId: 'vocab-tsuku',
        surfaceForm: '付き',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'sv-b',
        sentenceId: 'sent-b',
        vocabularyItemId: 'vocab-tsukeru',
        surfaceForm: '付け',
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.vocabularyConfusions.add({
      id: 'confusion-1',
      itemAId: 'vocab-tsuku',
      itemBId: 'vocab-tsukeru',
      confusionType: 'transitivity',
      observedCount: 1,
      lastObservedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await suppressVocabularyActivityTypes('vocab-tsuku');
    await suppressVocabularyActivityTypes('vocab-tsukeru');

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('付き');
    expect(screen.getByText('付け')).toBeInTheDocument();
    expect(screen.queryByText('つく')).not.toBeInTheDocument();
    expect(screen.queryByText('つける')).not.toBeInTheDocument();

    await waitFor(async () => {
      const seeded = await db.studyItems.where('subjectId').equals('confusion-1').toArray();
      expect(seeded).toHaveLength(1);
      expect(seeded[0]!.activityType).toBe('contrastive');
      expect(seeded[0]!.subjectType).toBe('vocabularyConfusion');
    });

    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByText('つく')).toBeInTheDocument();
    expect(screen.getByText('つける')).toBeInTheDocument();
    expect(screen.getByText('to turn on (intransitive)')).toBeInTheDocument();
    expect(screen.getByText('to turn on (transitive)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Good' }));
    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
  });

  it('auto-shows the mnemonic for a fragile (single-context) vocabulary item (Phase 7.5)', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await db.vocabularyItems.add({
      id: 'vocab-1',
      expression: '読む',
      reading: 'よむ',
      meaning: 'to read',
      notes: 'Sounds like "yomu" — think "you, move (your eyes)".',
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-1',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-1',
      surfaceForm: '読みます',
      createdAt: now,
      updatedAt: now,
    });

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('Reveal dictionary reading');
    // Async maturity check (computeVocabularyContextDiversity) — retry
    // until it resolves and flips mnemonicVisible, rather than asserting
    // on the very first render.
    await screen.findByText('💡 Sounds like "yomu" — think "you, move (your eyes)".');
    expect(
      screen.queryByRole('button', { name: 'Show mnemonic' }),
    ).not.toBeInTheDocument();
  });

  it('gates the mnemonic behind a button for a non-fragile (multi-source) vocabulary item, and records mnemonic_shown when opened (Phase 7.5)', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await db.vocabularyItems.add({
      id: 'vocab-1',
      expression: '読む',
      reading: 'よむ',
      meaning: 'to read',
      notes: 'Sounds like "yomu".',
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-1',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-1',
      surfaceForm: '読みます',
      createdAt: now,
      updatedAt: now,
    });
    // A second source (a different book) linking the same vocabulary item —
    // pushes context diversity to "generalized", so the mnemonic no longer
    // auto-shows. No sentences row needed for sent-2: diversity computation
    // only reads sentence_vocabulary + book_sentences + books.
    await db.books.add({
      id: 'book-2',
      title: 'Another Book',
      archived: false,
      chapters: [],
      updatedAt: now,
    });
    await db.bookSentences.add({
      id: 'bs-2',
      bookId: 'book-2',
      sentenceId: 'sent-2',
      position: 0,
      status: 'unstarted',
      addedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-2',
      sentenceId: 'sent-2',
      vocabularyItemId: 'vocab-1',
      createdAt: now,
      updatedAt: now,
    });

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('Reveal dictionary reading');
    expect(screen.queryByText('💡 Sounds like "yomu".')).not.toBeInTheDocument();
    const showButton = await screen.findByRole('button', { name: 'Show mnemonic' });

    await user.click(showButton);
    expect(screen.getByText('💡 Sounds like "yomu".')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reveal dictionary reading' }));
    await user.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(async () => {
      const review = (await db.reviews.toArray())[0];
      expect(review?.assistance).toEqual(['mnemonic_shown']);
    });
  });

  it('falls back to the WaniKani reading mnemonic (parsed markup) when the item has no learner note', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await db.vocabularyItems.add({
      id: 'vocab-1',
      expression: '読む',
      reading: 'よむ',
      meaning: 'to read',
      readingMnemonic:
        'The reading is <reading>よむ</reading>, like telling someone "<ja>you, move</ja>".',
      meaningMnemonic: 'This should not be the one shown for a reading card.',
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-1',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-1',
      surfaceForm: '読みます',
      createdAt: now,
      updatedAt: now,
    });

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('Reveal dictionary reading');
    await user.click(await screen.findByRole('button', { name: 'Show mnemonic' }));
    // Markup is parsed, not rendered literally, and the reading mnemonic wins.
    expect(screen.getByText('you, move')).toBeInTheDocument();
    expect(screen.queryByText(/This should not be the one shown/)).not.toBeInTheDocument();
    expect(screen.queryByText(/<reading>/)).not.toBeInTheDocument();
  });

  it('falls back to component-kanji mnemonics + hints when the word has no WaniKani vocab mnemonic', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await db.vocabularyItems.add({
      id: 'vocab-1',
      expression: '読む',
      reading: 'よむ',
      meaning: 'to read',
      createdAt: now,
      updatedAt: now,
    });
    await db.kanji.add({
      id: 'kanji-読',
      character: '読',
      meanings: ['read'],
      onyomi: ['ドク'],
      kunyomi: ['よ'],
      nanori: [],
      readingMnemonic: 'Read it as <reading>よ</reading>, like saying "yo!".',
      readingHint: 'Picture shouting "yo" at a book.',
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-1',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-1',
      surfaceForm: '読みます',
      createdAt: now,
      updatedAt: now,
    });

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('Reveal dictionary reading');
    // Single-context item — the mnemonic auto-shows once the async maturity
    // check resolves; if it hasn't, click the button. Either way the
    // component-kanji fallback content must appear.
    const showButton = screen.queryByRole('button', { name: 'Show mnemonic' });
    if (showButton) await user.click(showButton);
    expect(await screen.findByText(/like saying "yo!"/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByText(/Picture shouting "yo" at a book/)).toBeInTheDocument();
    expect(screen.getByText('読')).toBeInTheDocument();
  });

  it('treats a WaniKani "you already know the kanji" placeholder as no vocab mnemonic and shows the component kanji instead', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await db.vocabularyItems.add({
      id: 'vocab-1',
      expression: '読む',
      reading: 'よむ',
      meaning: 'to read',
      readingMnemonic:
        "This is a word that uses the kun'yomi reading you already learned for the kanji, so you should be able to read this word on your own.",
      createdAt: now,
      updatedAt: now,
    });
    await db.kanji.add({
      id: 'kanji-読',
      character: '読',
      meanings: ['read'],
      onyomi: ['ドク'],
      kunyomi: ['よ'],
      nanori: [],
      readingMnemonic: 'Read it as <reading>よ</reading>, like saying "yo!".',
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-1',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-1',
      surfaceForm: '読みます',
      createdAt: now,
      updatedAt: now,
    });

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('Reveal dictionary reading');
    const showButton = screen.queryByRole('button', { name: 'Show mnemonic' });
    if (showButton) await user.click(showButton);
    // The kanji mnemonic is what actually helps here.
    expect(await screen.findByText(/like saying "yo!"/, {}, { timeout: 3000 })).toBeInTheDocument();
    // The placeholder still appears, but only as a lead-in above it.
    expect(screen.getByText(/read this word on your own/)).toBeInTheDocument();
  });

  it('renders a listening card only when the sentence has reference audio, hides Japanese until reveal (Phase 7.4)', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    // Keep the two unconditional sentence-subject activity types out of the
    // queue so only the audio-eligible listening card seeds/renders here.
    await suppressUnconditionalSentenceActivityTypes('sent-1');

    await db.sentenceAudio.add({
      id: 'audio-1',
      sentenceId: 'sent-1',
      sourceId: 'source-1',
      sourceSentenceId: 'src-sent-1',
      sourceTitle: 'Test Source',
      mimeType: 'audio/mp3',
      durationMs: 1500,
      startMs: 0,
      endMs: 1500,
      blob: new Blob(['fake audio bytes'], { type: 'audio/mp3' }),
      importedAt: now,
    });

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByRole('button', { name: /Play native sentence recording/ });
    expect(screen.queryByText('本を読みます。')).not.toBeInTheDocument();

    await waitFor(async () => {
      const seeded = await db.studyItems
        .where('subjectId')
        .equals('sent-1')
        .and((item) => item.activityType === 'listening')
        .toArray();
      expect(seeded).toHaveLength(1);
      expect(seeded[0]?.subjectType).toBe('sentence');
    });

    await user.click(screen.getByRole('button', { name: 'Reveal text' }));
    expect(screen.getByText('本を読みます。')).toBeInTheDocument();
    expect(screen.queryByText('I read a book.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reveal translation' }));
    expect(screen.getByText('I read a book.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
  });

  it('applies the selected playback speed to the native audio element (listening card follow-up)', async () => {
    vi.stubGlobal('Audio', MockAudio);
    MockAudio.instances = [];
    try {
      await seedBookWithSentence();
      const db = getDb();
      const now = new Date().toISOString();
      await suppressUnconditionalSentenceActivityTypes('sent-1');
      await db.sentenceAudio.add({
        id: 'audio-1',
        sentenceId: 'sent-1',
        sourceId: 'source-1',
        sourceSentenceId: 'src-sent-1',
        sourceTitle: 'Test Source',
        mimeType: 'audio/mp3',
        durationMs: 1500,
        startMs: 0,
        endMs: 1500,
        blob: new Blob(['fake audio bytes'], { type: 'audio/mp3' }),
        importedAt: now,
      });

      const user = userEvent.setup();
      renderReviewPage('/books/book-1/review', 'books/:bookId/review');

      await screen.findByRole('button', { name: /Play native sentence recording/ });
      await user.selectOptions(screen.getByRole('combobox', { name: 'Speed' }), '0.5');
      await user.click(screen.getByRole('button', { name: /Play native sentence recording/ }));

      expect(MockAudio.instances).toHaveLength(1);
      expect(MockAudio.instances[0]!.playbackRate).toBe(0.5);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders the real sentence tokenized from its vocabulary suggestions, each token glossable (follow-up)', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    // Suggestions carry the char offsets the karaoke line tokenizes on.
    await db.sentences.update('sent-1', {
      readingOnly: 'ほんをよみます。',
      vocabularySuggestions: [
        {
          id: 'vs-1',
          surface: '本',
          start: 0,
          end: 1,
          expression: '本',
          reading: 'ほん',
          pos: '名詞',
          english: 'book',
          source: 'morphology',
          selectedByDefault: true,
        },
        {
          id: 'vs-2',
          surface: '読み',
          start: 2,
          end: 4,
          expression: '読む',
          reading: 'よむ',
          pos: '動詞',
          english: 'to read',
          source: 'morphology',
          selectedByDefault: true,
        },
      ],
    });
    await db.sentenceAudio.add({
      id: 'audio-1',
      sentenceId: 'sent-1',
      sourceId: 'source-1',
      sourceSentenceId: 'src-sent-1',
      sourceTitle: 'Test Source',
      mimeType: 'audio/mp3',
      durationMs: 1500,
      startMs: 0,
      endMs: 1500,
      blob: new Blob(['fake audio bytes'], { type: 'audio/mp3' }),
      importedAt: now,
    });
    await db.referenceAlignments.add({
      id: 'audio-1',
      alignmentVersion: ALIGNMENT_VERSION,
      computedAt: now,
      result: {
        durationSeconds: 1.5,
        words: [
          { start: 0, end: 0.6, text: '本を', phones: [] },
          { start: 0.6, end: 1.5, text: '読みます', phones: [] },
        ],
      },
    });

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByRole('button', { name: /Play native sentence recording/ });
    await user.click(screen.getByRole('button', { name: 'Reveal text' }));

    // The sentence renders as its own tokens (not the aligner's transcript),
    // and the kana reading line is shown separately underneath.
    expect(await screen.findByText('本')).toBeInTheDocument();
    expect(screen.getByText('読み')).toBeInTheDocument();
    expect(screen.getByText('ます。')).toBeInTheDocument();
    expect(screen.getByText('ほんをよみます。')).toBeInTheDocument();
  });

  async function seedWordListeningFixture(opts: { readingProficient: boolean }) {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await db.vocabularyItems.add({
      id: 'vocab-hon',
      expression: '本',
      reading: 'ほん',
      meaning: 'book',
      partOfSpeech: 'n',
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-hon',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-hon',
      surfaceForm: '本',
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceAudio.add({
      id: 'audio-1',
      sentenceId: 'sent-1',
      sourceId: 'source-1',
      sourceSentenceId: 'src-sent-1',
      sourceTitle: 'Test Source',
      mimeType: 'audio/mp3',
      durationMs: 1500,
      startMs: 0,
      endMs: 1500,
      blob: new Blob(['fake audio bytes'], { type: 'audio/mp3' }),
      importedAt: now,
    });
    // suppressVocabularyActivityTypes seeds reading_retrieval/cloze/
    // reading_production at state 'review' (far future) — which also makes the
    // word count as reading-proficient for the tier-1 word_listening gate.
    if (opts.readingProficient) await suppressVocabularyActivityTypes('vocab-hon');
  }

  const FAR_FUTURE_FSRS = (state: 'new' | 'learning' | 'review') => ({
    due: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    stability: 1,
    difficulty: 1,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 1,
    lapses: 0,
    state,
  });

  it('does not seed a word_listening card until the word\'s reading is proficient (tier 1)', async () => {
    await seedWordListeningFixture({ readingProficient: false });
    const db = getDb();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    // The vocabulary reading cards build/seed as normal...
    await waitFor(async () => {
      expect(await db.studyItems.where('activityType').equals('reading_retrieval').count()).toBe(1);
    });
    // ...but the word_listening card is withheld while the reading is unproven.
    expect(await db.studyItems.where('activityType').equals('word_listening').count()).toBe(0);
    expect(
      screen.queryByText('Listen to the whole sentence, then reveal which word to identify.'),
    ).not.toBeInTheDocument();
  });

  it('seeds and reviews a word_listening card once the word\'s reading is proficient', async () => {
    await seedWordListeningFixture({ readingProficient: true });
    const db = getDb();
    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText(
      'Listen to the whole sentence, then reveal which word to identify.',
    );
    await waitFor(async () => {
      const seeded = await db.studyItems.where('activityType').equals('word_listening').toArray();
      expect(seeded).toHaveLength(1);
      expect(seeded[0]?.subjectType).toBe('sentenceVocabulary');
      expect(seeded[0]?.subjectId).toBe('sv-hon');
    });

    await user.click(screen.getByRole('button', { name: 'Reveal sentence' }));
    // Audio cloze: the sentence shows with the target word blanked + its translation.
    expect(screen.getByText('I read a book.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reveal answer' }));
    expect(screen.getByText('ほん')).toBeInTheDocument();
    expect(screen.getByText('book')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Good' }));
    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
  });

  it('withholds the full-sentence listening card until its word_listening items are proficient (tier 2)', async () => {
    await seedWordListeningFixture({ readingProficient: true });
    const db = getDb();
    const now = new Date().toISOString();
    // A word_listening item exists but is not yet proficient...
    await db.studyItems.add({
      id: 'si-wl',
      subjectType: 'sentenceVocabulary',
      subjectId: 'sv-hon',
      activityType: 'word_listening',
      fsrsState: FAR_FUTURE_FSRS('learning'),
      createdAt: now,
      updatedAt: now,
    });
    // ...and a full-sentence listening card is due.
    await db.studyItems.add({
      id: 'si-listening',
      subjectType: 'sentence',
      subjectId: 'sent-1',
      activityType: 'listening',
      fsrsState: { ...FAR_FUTURE_FSRS('new'), due: now },
      createdAt: now,
      updatedAt: now,
    });

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('All caught up.');
    expect(
      screen.queryByRole('button', { name: /Play native sentence recording/ }),
    ).not.toBeInTheDocument();
  });

  it('surfaces the full-sentence listening card once every word_listening item is proficient (tier 2)', async () => {
    await seedWordListeningFixture({ readingProficient: true });
    const db = getDb();
    const now = new Date().toISOString();
    await db.studyItems.add({
      id: 'si-wl',
      subjectType: 'sentenceVocabulary',
      subjectId: 'sv-hon',
      activityType: 'word_listening',
      fsrsState: FAR_FUTURE_FSRS('review'),
      createdAt: now,
      updatedAt: now,
    });
    await db.studyItems.add({
      id: 'si-listening',
      subjectType: 'sentence',
      subjectId: 'sent-1',
      activityType: 'listening',
      fsrsState: { ...FAR_FUTURE_FSRS('new'), due: now },
      createdAt: now,
      updatedAt: now,
    });

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByRole('button', { name: /Play native sentence recording/ });
    expect(screen.getByRole('button', { name: 'Reveal text' })).toBeInTheDocument();
  });

  it('never leaks the aligner\'s <unk> token into the displayed sentence', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await db.sentenceAudio.add({
      id: 'audio-1',
      sentenceId: 'sent-1',
      sourceId: 'source-1',
      sourceSentenceId: 'src-sent-1',
      sourceTitle: 'Test Source',
      mimeType: 'audio/mp3',
      durationMs: 1500,
      startMs: 0,
      endMs: 1500,
      blob: new Blob(['fake audio bytes'], { type: 'audio/mp3' }),
      importedAt: now,
    });
    await db.referenceAlignments.add({
      id: 'audio-1',
      alignmentVersion: ALIGNMENT_VERSION,
      computedAt: now,
      result: {
        durationSeconds: 1.5,
        words: [
          { start: 0, end: 0.6, text: '<unk>', phones: [] },
          { start: 0.6, end: 1.5, text: '読みます', phones: [] },
        ],
      },
    });

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByRole('button', { name: /Play native sentence recording/ });
    await user.click(screen.getByRole('button', { name: 'Reveal text' }));

    // The real sentence is what's rendered — the aligner transcript (and its
    // <unk> / dictionary-normalized spellings) never reaches the screen.
    expect(await screen.findByText('本を読みます。')).toBeInTheDocument();
    expect(screen.queryByText('<unk>')).not.toBeInTheDocument();
    expect(screen.queryByText('?')).not.toBeInTheDocument();
  });

  it('records audio_replayed assistance only on a genuine replay, not the first play (Phase 7.5)', async () => {
    vi.stubGlobal('Audio', MockAudio);
    MockAudio.instances = [];
    try {
      await seedBookWithSentence();
      const db = getDb();
      const now = new Date().toISOString();
      await suppressUnconditionalSentenceActivityTypes('sent-1');
      await db.sentenceAudio.add({
        id: 'audio-1',
        sentenceId: 'sent-1',
        sourceId: 'source-1',
        sourceSentenceId: 'src-sent-1',
        sourceTitle: 'Test Source',
        mimeType: 'audio/mp3',
        durationMs: 1500,
        startMs: 0,
        endMs: 1500,
        blob: new Blob(['fake audio bytes'], { type: 'audio/mp3' }),
        importedAt: now,
      });

      const user = userEvent.setup();
      renderReviewPage('/books/book-1/review', 'books/:bookId/review');

      const playButtonName = /Play native sentence recording/;
      await user.click(await screen.findByRole('button', { name: playButtonName }));
      expect(MockAudio.instances).toHaveLength(1);

      // Simulate playback finishing, then play again — a genuine replay.
      act(() => {
        MockAudio.instances[0]!.onended?.();
      });
      await user.click(await screen.findByRole('button', { name: playButtonName }));
      expect(MockAudio.instances).toHaveLength(2);

      await user.click(screen.getByRole('button', { name: 'Reveal text' }));
      await user.click(screen.getByRole('button', { name: 'Reveal translation' }));
      await user.click(screen.getByRole('button', { name: 'Good' }));

      await waitFor(async () => {
        const review = (await db.reviews.toArray())[0];
        expect(review?.assistance).toEqual(['audio_replayed']);
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not record audio_replayed assistance for just one play', async () => {
    vi.stubGlobal('Audio', MockAudio);
    MockAudio.instances = [];
    try {
      await seedBookWithSentence();
      const db = getDb();
      const now = new Date().toISOString();
      await suppressUnconditionalSentenceActivityTypes('sent-1');
      await db.sentenceAudio.add({
        id: 'audio-1',
        sentenceId: 'sent-1',
        sourceId: 'source-1',
        sourceSentenceId: 'src-sent-1',
        sourceTitle: 'Test Source',
        mimeType: 'audio/mp3',
        durationMs: 1500,
        startMs: 0,
        endMs: 1500,
        blob: new Blob(['fake audio bytes'], { type: 'audio/mp3' }),
        importedAt: now,
      });

      const user = userEvent.setup();
      renderReviewPage('/books/book-1/review', 'books/:bookId/review');

      await user.click(
        await screen.findByRole('button', { name: /Play native sentence recording/ }),
      );
      await user.click(screen.getByRole('button', { name: 'Reveal text' }));
      await user.click(screen.getByRole('button', { name: 'Reveal translation' }));
      await user.click(screen.getByRole('button', { name: 'Good' }));

      await waitFor(async () => {
        const review = (await db.reviews.toArray())[0];
        expect(review?.assistance).toBeUndefined();
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not seed a listening card for a sentence with no reference audio', async () => {
    await seedBookWithSentence();
    const db = getDb();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('本を読みます。');
    await waitFor(async () => {
      expect(await db.studyItems.count()).toBe(2); // comprehension + reading_in_context only
    });
    expect(screen.queryByRole('button', { name: /Play native sentence recording/ })).not.toBeInTheDocument();
  });

  it('shows an empty state when there is nothing to review', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.books.add({
      id: 'book-empty',
      title: 'Empty Book',
      archived: false,
      chapters: [],
      updatedAt: now,
    });
    renderReviewPage('/books/book-empty/review', 'books/:bookId/review');

    expect(
      await screen.findByText('No sentences to review here yet.'),
    ).toBeInTheDocument();
  });

  it('stops introducing new subjects once the session planner\'s new-card cap is reached (Phase 7.10)', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await updateSettings({ newCardsPerSessionLimit: 1 });
    await db.books.add({
      id: 'book-1',
      title: 'Test Book',
      archived: false,
      chapters: [],
      updatedAt: now,
    });
    for (const [id, japanese] of [
      ['sent-1', '本を読みます。'],
      ['sent-2', '猫がいます。'],
      ['sent-3', '水を飲みます。'],
    ] as const) {
      await db.sentences.add({
        id,
        normalizedKey: id,
        japanese,
        readingOnly: '',
        inlineReading: '',
        translation: `(${id})`,
        targetVocabulary: [],
        vocabularySuggestions: [],
        sourceReferences: [],
        conflicts: [],
        firstOccurrenceIndex: 0,
        importBatchIds: [],
        createdAt: now,
        updatedAt: now,
      });
      await db.bookSentences.add({
        id: `bs-${id}`,
        bookId: 'book-1',
        sentenceId: id,
        position: 0,
        status: 'unstarted',
        addedAt: now,
      });
      await db.analyses.add({
        sentenceId: id,
        chunks: [],
        notes: '',
        status: 'empty',
        formatVersion: 2,
        vocabularyReviewStatus: 'confirmed',
        vocabularySelections: [],
        createdAt: now,
        updatedAt: now,
      });
    }

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    // Only sent-1's two activity types should seed (one "new subject" batch).
    await screen.findByText('本を読みます。');
    await waitFor(async () => {
      expect(await db.studyItems.count()).toBe(2);
    });

    await user.click(await screen.findByRole('button', { name: 'Reveal' }));
    await user.click(screen.getByRole('button', { name: 'Good' }));
    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
    await user.click(await screen.findByRole('button', { name: 'Reveal' }));
    await user.click(screen.getByRole('button', { name: 'Good' }));

    expect(
      await screen.findByText(/New-card limit reached for this session/),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 of 1 introduced/)).toBeInTheDocument();
    expect(screen.getByText(/2 more waiting next time/)).toBeInTheDocument();
    // sent-2/sent-3 never got seeded.
    expect(await db.studyItems.count()).toBe(2);
  });

  it('interleaves new-subject seeding across categories instead of draining sentences first (Phase 7.10)', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.books.add({
      id: 'book-1',
      title: 'Test Book',
      archived: false,
      chapters: [],
      updatedAt: now,
    });
    // Three plain sentences, none related to the vocabulary item below.
    for (const [id, japanese] of [
      ['sent-1', '本を読みます。'],
      ['sent-2', '猫がいます。'],
      ['sent-3', '水を飲みます。'],
    ] as const) {
      await db.sentences.add({
        id,
        normalizedKey: id,
        japanese,
        readingOnly: '',
        inlineReading: '',
        translation: `(${id})`,
        targetVocabulary: [],
        vocabularySuggestions: [],
        sourceReferences: [],
        conflicts: [],
        firstOccurrenceIndex: 0,
        importBatchIds: [],
        createdAt: now,
        updatedAt: now,
      });
      await db.bookSentences.add({
        id: `bs-${id}`,
        bookId: 'book-1',
        sentenceId: id,
        position: 0,
        status: 'unstarted',
        addedAt: now,
      });
      await db.analyses.add({
        sentenceId: id,
        chunks: [],
        notes: '',
        status: 'empty',
        formatVersion: 2,
        vocabularyReviewStatus: 'confirmed',
        vocabularySelections: [],
        createdAt: now,
        updatedAt: now,
      });
    }
    // A vocabulary item linked to sent-2 (not sent-1 — Phase 7.11's
    // full-sentence gate would otherwise block sent-1's own cards on
    // vocab-1 not being proficient yet, which isn't what this test is
    // about) — with the old category-major pending-seed order this would
    // only seed after all three sentences' six sentence-subject cards were
    // exhausted; interleaved, it should seed right after sent-1's own two
    // cards.
    await db.vocabularyItems.add({
      id: 'vocab-1',
      expression: '読む',
      reading: 'よむ',
      meaning: 'to read',
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-1',
      sentenceId: 'sent-2',
      vocabularyItemId: 'vocab-1',
      surfaceForm: '読みます',
      createdAt: now,
      updatedAt: now,
    });

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    // First batch: sent-1's two sentence-subject cards.
    await screen.findByText('本を読みます。');
    await waitFor(async () => {
      expect(await db.studyItems.count()).toBe(2);
    });
    await user.click(await screen.findByRole('button', { name: 'Reveal' }));
    await user.click(screen.getByRole('button', { name: 'Good' }));
    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
    await user.click(await screen.findByRole('button', { name: 'Reveal' }));
    await user.click(screen.getByRole('button', { name: 'Good' }));
    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(2);
    });

    // Second batch should be vocab-1's cards, not sent-2's — proves
    // interleaving rather than draining every sentence first.
    await screen.findByText('Reveal dictionary reading');
    const seeded = await db.studyItems.where('subjectId').equals('vocab-1').toArray();
    expect(seeded.map((item) => item.activityType).sort()).toEqual([
      'cloze',
      'reading_production',
      'reading_retrieval',
    ]);
    const sent2Items = await db.studyItems.where('subjectId').equals('sent-2').toArray();
    expect(sent2Items).toHaveLength(0);
  });

  it('never shows a graduated study item as due, even though a due, non-graduated one still shows (Phase 7.10)', async () => {
    await updateSettings({ graduationMinScheduledDays: 180 });
    const db = getDb();
    const now = new Date().toISOString();
    await db.books.add({
      id: 'book-1',
      title: 'Test Book',
      archived: false,
      chapters: [],
      updatedAt: now,
    });
    await db.sentences.add({
      id: 'sent-1',
      normalizedKey: 'sent-1',
      japanese: '本を読みます。',
      readingOnly: '',
      inlineReading: '',
      translation: 'I read a book.',
      targetVocabulary: [],
      vocabularySuggestions: [],
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 0,
      importBatchIds: [],
      createdAt: now,
      updatedAt: now,
    });
    await db.bookSentences.add({
      id: 'bs-1',
      bookId: 'book-1',
      sentenceId: 'sent-1',
      position: 0,
      status: 'unstarted',
      addedAt: now,
    });
    // Vocabulary review confirmed with nothing linked, so Phase 7.11's
    // full-sentence gate doesn't also hide these cards — this test is
    // specifically about graduation, not vocabulary gating.
    await db.analyses.add({
      sentenceId: 'sent-1',
      chunks: [],
      notes: '',
      status: 'empty',
      formatVersion: 2,
      vocabularyReviewStatus: 'confirmed',
      vocabularySelections: [],
      createdAt: now,
      updatedAt: now,
    });
    // comprehension: due now, but graduated (long-standing review interval).
    await db.studyItems.add({
      id: 'si-graduated',
      subjectType: 'sentence',
      subjectId: 'sent-1',
      activityType: 'comprehension',
      fsrsState: {
        due: now,
        stability: 50,
        difficulty: 3,
        elapsedDays: 0,
        scheduledDays: 200,
        learningSteps: 0,
        reps: 5,
        lapses: 0,
        state: 'review',
      },
      createdAt: now,
      updatedAt: now,
    });
    // reading_in_context: due now, short interval — not graduated.
    await db.studyItems.add({
      id: 'si-not-graduated',
      subjectType: 'sentence',
      subjectId: 'sent-1',
      activityType: 'reading_in_context',
      fsrsState: {
        due: now,
        stability: 5,
        difficulty: 3,
        elapsedDays: 0,
        scheduledDays: 3,
        learningSteps: 0,
        reps: 2,
        lapses: 0,
        state: 'review',
      },
      createdAt: now,
      updatedAt: now,
    });

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    // Only the non-graduated card should ever show.
    await screen.findByText(/Reading in context/);
    expect(screen.queryByText(/^Comprehension/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    await user.click(screen.getByRole('button', { name: 'Good' }));

    // Graduated item stays graduated — nothing else was due/pending, so
    // the queue empties instead of ever showing the graduated card.
    await screen.findByText('All caught up.');
  });

  it('buries a due sibling card for the session once another card for the same word has shown', async () => {
    await seedBookWithSentence();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    const db = getDb();
    const now = new Date().toISOString();

    await db.vocabularyItems.add({
      id: 'vocab-1',
      expression: '読む',
      reading: 'よむ',
      meaning: 'to read',
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-1',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-1',
      surfaceForm: '読みます',
      createdAt: now,
      updatedAt: now,
    });

    // Both settled in the stable `review` state and due now — this is the
    // 世話 case: graded alike each session they land on adjacent FSRS due
    // timestamps, so revealing the reading on the first turns the second
    // into a short-term echo test. reading_retrieval is due a hair earlier,
    // so it's the one that shows.
    const reviewState = (due: string) => ({
      due,
      stability: 8,
      difficulty: 3,
      elapsedDays: 0,
      scheduledDays: 6,
      learningSteps: 0,
      reps: 3,
      lapses: 0,
      state: 'review' as const,
    });
    await db.studyItems.add({
      id: 'si-retrieval',
      subjectType: 'vocabularyItem',
      subjectId: 'vocab-1',
      activityType: 'reading_retrieval',
      fsrsState: reviewState('2020-01-01T00:00:00.000Z'),
      createdAt: now,
      updatedAt: now,
    });
    await db.studyItems.add({
      id: 'si-cloze',
      subjectType: 'vocabularyItem',
      subjectId: 'vocab-1',
      activityType: 'cloze',
      fsrsState: reviewState('2020-01-01T00:00:01.000Z'),
      createdAt: now,
      updatedAt: now,
    });
    // reading_production exists too (far-future) so it isn't lazily seeded
    // as a brand-new card and shown — this test is about the buried sibling.
    await db.studyItems.add({
      id: 'si-production',
      subjectType: 'vocabularyItem',
      subjectId: 'vocab-1',
      activityType: 'reading_production',
      fsrsState: {
        ...reviewState(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()),
        scheduledDays: 0,
      },
      createdAt: now,
      updatedAt: now,
    });

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('Reveal dictionary reading');
    await user.click(screen.getByRole('button', { name: 'Reveal dictionary reading' }));
    await user.click(screen.getByRole('button', { name: 'Good' }));

    // The cloze sibling is held for next session rather than shown now.
    await screen.findByText('All caught up.');
    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
    // It stays due — nothing about its FSRS state changed, it just didn't
    // get a slot today.
    const cloze = await db.studyItems.get('si-cloze');
    expect(cloze?.fsrsState.due).toBe('2020-01-01T00:00:01.000Z');
  });

  // ---------------------------------------------------------------------
  // Grammar-pattern review (grammar-learning system Phase 5, docs/STATUS.md).
  // Global scope only (no bookId) — see GRAMMAR_ACTIVITY_TYPES's doc
  // comment in ReviewPage.tsx. Unlike every other category, a grammar
  // study item is never lazily seeded by ReviewPage itself, so these tests
  // pre-seed via ensureGrammarStudyItem directly (mirroring how "Track" in
  // GrammarPicker would) rather than relying on the pending-seed pool.
  // ---------------------------------------------------------------------

  it('renders a grammar_comprehension card, reveals the pattern meaning, and records the review', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.sentences.add({
      id: 'sent-grammar-1',
      normalizedKey: 'sent-grammar-1',
      japanese: 'そんなこと言うわけないでしょ。',
      readingOnly: '',
      inlineReading: '',
      translation: "There's no way I'd say something like that.",
      targetVocabulary: [],
      vocabularySuggestions: [],
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 0,
      importBatchIds: [],
      createdAt: now,
      updatedAt: now,
    });
    await suppressUnconditionalSentenceActivityTypes('sent-grammar-1');
    await confirmSentenceVocabulary('sent-grammar-1', []);

    const pattern = await ensureGrammarPattern('〜わけがない', {
      shortMeaning: "there's no way...",
    });
    await ensureSentenceGrammar('sent-grammar-1', pattern.id, { confirmedByLearner: true });
    await ensureGrammarStudyItem(pattern.id, 'grammar_comprehension');
    // Keep grammar_completion out of this test's queue/pending-seed pool
    // entirely — it already has a study item, just far in the future.
    const completionItem = await ensureGrammarStudyItem(pattern.id, 'grammar_completion');
    await db.studyItems.update(completionItem.id, {
      fsrsState: {
        due: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        stability: 1,
        difficulty: 1,
        elapsedDays: 0,
        scheduledDays: 1,
        learningSteps: 0,
        reps: 1,
        lapses: 0,
        state: 'review',
      },
    });

    const user = userEvent.setup();
    renderReviewPage('/review', '/review');

    await screen.findByText('そんなこと言うわけないでしょ。');
    expect(screen.getByText(/What does/)).toBeInTheDocument();
    expect(screen.getByText(/Grammar comprehension/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(await screen.findByText("there's no way...")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(async () => {
      const reviews = await db.reviews.toArray();
      expect(reviews.some((review) => review.rating === 'good')).toBe(true);
    });
  });

  it('renders a grammar_completion card, grades the chosen construction, and records the review', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.sentences.add({
      id: 'sent-grammar-2',
      normalizedKey: 'sent-grammar-2',
      japanese: '忘れるわけがない。',
      readingOnly: '',
      inlineReading: '',
      translation: "There's no way I'd forget.",
      targetVocabulary: [],
      vocabularySuggestions: [],
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 0,
      importBatchIds: [],
      createdAt: now,
      updatedAt: now,
    });
    await suppressUnconditionalSentenceActivityTypes('sent-grammar-2');
    await confirmSentenceVocabulary('sent-grammar-2', []);

    const correct = await ensureGrammarPattern('〜わけがない', {
      shortMeaning: "there's no way...",
    });
    await ensureGrammarPattern('〜はずがない');
    await ensureGrammarPattern('〜てしまう');
    await ensureSentenceGrammar('sent-grammar-2', correct.id, { confirmedByLearner: true });
    const comprehensionItem = await ensureGrammarStudyItem(correct.id, 'grammar_comprehension');
    await db.studyItems.update(comprehensionItem.id, {
      fsrsState: {
        due: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        stability: 1,
        difficulty: 1,
        elapsedDays: 0,
        scheduledDays: 1,
        learningSteps: 0,
        reps: 1,
        lapses: 0,
        state: 'review',
      },
    });
    await ensureGrammarStudyItem(correct.id, 'grammar_completion');

    const user = userEvent.setup();
    renderReviewPage('/review', '/review');

    await screen.findByText(/Which construction/);
    // Blanking: 〜わけがない strips to わけがない, which appears verbatim
    // in 忘れるわけがない — so the sentence should render blanked.
    expect(screen.queryByText('忘れるわけがない。')).not.toBeInTheDocument();
    expect(screen.getByText('_____')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '〜わけがない' }));

    expect(await screen.findByText('✓ Correct')).toBeInTheDocument();
    expect(screen.queryByText('_____')).not.toBeInTheDocument();
    expect(screen.getAllByText('〜わけがない').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(async () => {
      const reviews = await db.reviews.toArray();
      expect(reviews.some((review) => review.responseRaw === '〜わけがない')).toBe(true);
    });
    const [review] = await db.reviews
      .filter((item) => item.responseRaw === '〜わけがない')
      .toArray();
    expect(review?.expectedAnswer).toBe('〜わけがない');
    expect(review?.rating).toBe('good');
  });

  it('ranks a GrammarRelationship-linked pattern ahead of the rest of the corpus as a grammar_completion distractor', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.sentences.add({
      id: 'sent-grammar-3',
      normalizedKey: 'sent-grammar-3',
      japanese: '忘れるわけがない。',
      readingOnly: '',
      inlineReading: '',
      translation: "There's no way I'd forget.",
      targetVocabulary: [],
      vocabularySuggestions: [],
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 0,
      importBatchIds: [],
      createdAt: now,
      updatedAt: now,
    });
    await suppressUnconditionalSentenceActivityTypes('sent-grammar-3');
    await confirmSentenceVocabulary('sent-grammar-3', []);

    const correct = await ensureGrammarPattern('〜わけがない');
    const others = await Promise.all(
      ['〜はずがない', '〜てしまう', '〜ながら', '〜ば', '〜たら', '〜のに'].map((name) =>
        ensureGrammarPattern(name),
      ),
    );
    // Find a pattern that would NOT be among the default (no-relationship)
    // distractor picks, so linking it is the only way it can show up —
    // proving the relationship, not hash luck, drove the selection.
    const unranked = buildGrammarCompletionChoices(correct, others);
    const excluded = others.find(
      (pattern) => !unranked.some((choice) => choice.id === pattern.id),
    );
    expect(excluded).toBeDefined();
    await ensureGrammarRelationship(correct.id, excluded!.id, 'commonly_confused');

    await ensureSentenceGrammar('sent-grammar-3', correct.id, { confirmedByLearner: true });
    const comprehensionItem = await ensureGrammarStudyItem(correct.id, 'grammar_comprehension');
    await db.studyItems.update(comprehensionItem.id, {
      fsrsState: {
        due: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        stability: 1,
        difficulty: 1,
        elapsedDays: 0,
        scheduledDays: 1,
        learningSteps: 0,
        reps: 1,
        lapses: 0,
        state: 'review',
      },
    });
    await ensureGrammarStudyItem(correct.id, 'grammar_completion');

    renderReviewPage('/review', '/review');

    await screen.findByText(/Which construction/);
    expect(screen.getByRole('button', { name: excluded!.canonicalName })).toBeInTheDocument();
  });

  it('renders a grammar_contrast card, grades the chosen construction, and records the review', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.sentences.add({
      id: 'sent-grammar-4',
      normalizedKey: 'sent-grammar-4',
      japanese: '忘れるわけがない。',
      readingOnly: '',
      inlineReading: '',
      translation: "There's no way I'd forget.",
      targetVocabulary: [],
      vocabularySuggestions: [],
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 0,
      importBatchIds: [],
      createdAt: now,
      updatedAt: now,
    });
    await suppressUnconditionalSentenceActivityTypes('sent-grammar-4');
    await confirmSentenceVocabulary('sent-grammar-4', []);

    const correct = await ensureGrammarPattern('〜わけがない', {
      shortMeaning: "there's no way...",
    });
    const confusable = await ensureGrammarPattern('〜はずがない');
    await ensureGrammarRelationship(correct.id, confusable.id, 'commonly_confused');
    await ensureSentenceGrammar('sent-grammar-4', correct.id, { confirmedByLearner: true });

    const futureFsrsState = {
      due: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      stability: 1,
      difficulty: 1,
      elapsedDays: 0,
      scheduledDays: 1,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
      state: 'review' as const,
    };
    const comprehensionItem = await ensureGrammarStudyItem(correct.id, 'grammar_comprehension');
    await db.studyItems.update(comprehensionItem.id, { fsrsState: futureFsrsState });
    const completionItem = await ensureGrammarStudyItem(correct.id, 'grammar_completion');
    await db.studyItems.update(completionItem.id, { fsrsState: futureFsrsState });
    // Left due now (default new-item state) — the only card that should
    // actually surface in this test's queue.
    await ensureGrammarStudyItem(correct.id, 'grammar_contrast');

    const user = userEvent.setup();
    renderReviewPage('/review', '/review');

    await screen.findByText(/Which construction is used here/);
    expect(screen.getByText('忘れるわけがない。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '〜わけがない' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '〜はずがない' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '〜わけがない' }));

    expect(await screen.findByText('✓ Correct')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(async () => {
      const reviews = await db.reviews.toArray();
      expect(reviews.some((review) => review.responseRaw === '〜わけがない')).toBe(true);
    });
    const [review] = await db.reviews
      .filter((item) => item.responseRaw === '〜わけがない')
      .toArray();
    expect(review?.expectedAnswer).toBe('〜わけがない');
    expect(review?.rating).toBe('good');
  });

  it('lazily seeds a grammar_contrast study item once a relationship makes a candidate available for an already-tracked pattern', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.sentences.add({
      id: 'sent-grammar-5',
      normalizedKey: 'sent-grammar-5',
      japanese: '忘れるわけがない。',
      readingOnly: '',
      inlineReading: '',
      translation: "There's no way I'd forget.",
      targetVocabulary: [],
      vocabularySuggestions: [],
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 0,
      importBatchIds: [],
      createdAt: now,
      updatedAt: now,
    });
    await suppressUnconditionalSentenceActivityTypes('sent-grammar-5');
    await confirmSentenceVocabulary('sent-grammar-5', []);

    const correct = await ensureGrammarPattern('〜わけがない');
    const confusable = await ensureGrammarPattern('〜はずがない');
    await ensureGrammarRelationship(correct.id, confusable.id, 'commonly_confused');
    await ensureSentenceGrammar('sent-grammar-5', correct.id, { confirmedByLearner: true });

    const futureFsrsState = {
      due: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      stability: 1,
      difficulty: 1,
      elapsedDays: 0,
      scheduledDays: 1,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
      state: 'review' as const,
    };
    const comprehensionItem = await ensureGrammarStudyItem(correct.id, 'grammar_comprehension');
    await db.studyItems.update(comprehensionItem.id, { fsrsState: futureFsrsState });
    const completionItem = await ensureGrammarStudyItem(correct.id, 'grammar_completion');
    await db.studyItems.update(completionItem.id, { fsrsState: futureFsrsState });
    // No grammar_contrast study item pre-seeded — this test's whole point
    // is that the generic pending-seed pool creates one once a candidate
    // (the relationship above) exists for an already-tracked pattern.
    expect(
      await db.studyItems.where('subjectId').equals(correct.id).count(),
    ).toBe(2);

    renderReviewPage('/review', '/review');

    await screen.findByText(/Which construction is used here/);
    const studyItems = await db.studyItems.where('subjectId').equals(correct.id).toArray();
    expect(studyItems.some((item) => item.activityType === 'grammar_contrast')).toBe(true);
  });

  it('lazily seeds and renders a grammar_production card once the pattern is recognized (comprehension FSRS-proficient), self-rated with no expectedAnswer', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.sentences.add({
      id: 'sent-grammar-6',
      normalizedKey: 'sent-grammar-6',
      japanese: '忘れるわけがない。',
      readingOnly: '',
      inlineReading: '',
      translation: "There's no way I'd forget.",
      targetVocabulary: [],
      vocabularySuggestions: [],
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 0,
      importBatchIds: [],
      createdAt: now,
      updatedAt: now,
    });
    await suppressUnconditionalSentenceActivityTypes('sent-grammar-6');
    await confirmSentenceVocabulary('sent-grammar-6', []);

    const pattern = await ensureGrammarPattern('〜わけがない', { shortMeaning: "there's no way..." });
    await ensureSentenceGrammar('sent-grammar-6', pattern.id, { confirmedByLearner: true });

    const proficient = {
      due: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      stability: 1,
      difficulty: 1,
      elapsedDays: 0,
      scheduledDays: 1,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
      state: 'review' as const,
    };
    const comprehensionItem = await ensureGrammarStudyItem(pattern.id, 'grammar_comprehension');
    await db.studyItems.update(comprehensionItem.id, { fsrsState: proficient });
    const completionItem = await ensureGrammarStudyItem(pattern.id, 'grammar_completion');
    await db.studyItems.update(completionItem.id, { fsrsState: proficient });
    // No grammar_production item pre-seeded — the pending-seed pool creates it.

    const user = userEvent.setup();
    renderReviewPage('/review', '/review');

    await screen.findByText(/Write a sentence that uses/);
    const box = screen.getByPlaceholderText('Your sentence…');
    await user.type(box, 'そんなことあるわけがない。');
    await user.click(screen.getByRole('button', { name: 'Reveal model' }));

    expect(await screen.findByText(/appears in your sentence/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(async () => {
      const items = await db.studyItems.where('subjectId').equals(pattern.id).toArray();
      expect(items.some((item) => item.activityType === 'grammar_production')).toBe(true);
    });
    const productionItem = (await db.studyItems.where('subjectId').equals(pattern.id).toArray()).find(
      (item) => item.activityType === 'grammar_production',
    );
    const [review] = await db.reviews.where('studyItemId').equals(productionItem!.id).toArray();
    expect(review?.responseRaw).toBe('そんなことあるわけがない。');
    expect(review?.expectedAnswer).toBeUndefined();
    expect(review?.rating).toBe('good');
  });

  it('withholds grammar_production while the pattern is only tracked, not yet recognized', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.sentences.add({
      id: 'sent-grammar-7',
      normalizedKey: 'sent-grammar-7',
      japanese: '忘れるわけがない。',
      readingOnly: '',
      inlineReading: '',
      translation: "There's no way I'd forget.",
      targetVocabulary: [],
      vocabularySuggestions: [],
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 0,
      importBatchIds: [],
      createdAt: now,
      updatedAt: now,
    });
    await suppressUnconditionalSentenceActivityTypes('sent-grammar-7');
    await confirmSentenceVocabulary('sent-grammar-7', []);

    const pattern = await ensureGrammarPattern('〜わけがない', { shortMeaning: "there's no way..." });
    await ensureSentenceGrammar('sent-grammar-7', pattern.id, { confirmedByLearner: true });
    // Comprehension tracked but left in the default 'new' state — not recognized yet.
    await ensureGrammarStudyItem(pattern.id, 'grammar_comprehension');
    await ensureGrammarStudyItem(pattern.id, 'grammar_completion');

    renderReviewPage('/review', '/review');
    await screen.findByText(/What does/);
    const items = await db.studyItems.where('subjectId').equals(pattern.id).toArray();
    expect(items.some((item) => item.activityType === 'grammar_production')).toBe(false);
  });
});
