import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { nativeAudioController } from '../src/lib/nativeAudio';
import { ReviewPage } from '../src/pages/ReviewPage';
import { withAppProviders } from '../src/test/providers';

// Minimal fake <audio> so listening-card tests can drive playback/`onended`
// deterministically — mirrors tests/nativeAudio.test.ts's own MockAudio,
// since real jsdom HTMLMediaElement playback isn't reliable.
class MockAudio {
  static instances: MockAudio[] = [];
  src: string;
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

    // reading_retrieval card first — shows the word, hides the reading.
    await screen.findByText('Reveal reading');
    expect(screen.getByText('読みます')).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: 'Reveal reading' }));
    expect(screen.getByText('よむ')).toBeInTheDocument();
    expect(screen.getByText('to read')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Good' }));

    // cloze card next — the word itself is blanked until reveal.
    await screen.findByText('Reveal word');
    expect(screen.queryByText('読みます')).not.toBeInTheDocument();
    expect(screen.getByText('_____')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reveal word' }));
    expect(screen.getByText('読みます')).toBeInTheDocument();
    expect(screen.getByText('よむ')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Good' }));

    // reading_production card last — types the reading, checks, then rates.
    await screen.findByText('Type the reading');
    await user.type(screen.getByLabelText('Type the reading'), 'よむ');
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

    await screen.findByText('Type the reading');
    await user.type(screen.getByLabelText('Type the reading'), 'よみます');
    await user.click(screen.getByRole('button', { name: 'Check' }));

    expect(screen.getByText('✗ Not quite')).toBeInTheDocument();
    expect(screen.getByText('よむ')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Again' }));

    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
    const [review] = await db.reviews.toArray();
    expect(review?.rating).toBe('again');
    expect(review?.responseRaw).toBe('よみます');
    expect(review?.expectedAnswer).toBe('よむ');
  });

  it('renders a sentence-transformation card for a conjugable vocabulary item and checks the typed conjugated reading (Phase 7.9)', async () => {
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
    await db.sentenceVocabulary.add({
      id: 'sv-hanasu',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-hanasu',
      surfaceForm: '話す',
      createdAt: now,
      updatedAt: now,
    });
    // Suppress reading_retrieval/cloze/reading_production so only
    // sentence_transformation seeds for this word.
    await suppressVocabularyActivityTypes('vocab-hanasu');

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('Conjugate to: Plain past');
    expect(screen.getByText('話す')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Type the conjugated reading'), 'はなした');
    await user.click(screen.getByRole('button', { name: 'Check' }));

    expect(screen.getByText('✓ Correct')).toBeInTheDocument();
    expect(screen.getByText('話した')).toBeInTheDocument();
    expect(screen.getByText('はなした')).toBeInTheDocument();
    expect(screen.getByText('to speak')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
    const [review] = await db.reviews.toArray();
    expect(review?.responseRaw).toBe('はなした');
    expect(review?.expectedAnswer).toBe('はなした');

    const studyItems = await db.studyItems
      .where('subjectId')
      .equals('vocab-hanasu')
      .toArray();
    const transformationItem = studyItems.find(
      (item) => item.activityType === 'sentence_transformation',
    );
    expect(transformationItem?.subjectType).toBe('vocabularyItem');
  });

  it('does not seed a sentence-transformation card for a non-conjugable (or non-conjugating) vocabulary item', async () => {
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

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('Reveal reading');
    await waitFor(async () => {
      const studyItems = await db.studyItems
        .where('subjectId')
        .equals('vocab-hon')
        .toArray();
      expect(studyItems.length).toBeGreaterThan(0);
      expect(
        studyItems.some((item) => item.activityType === 'sentence_transformation'),
      ).toBe(false);
    });
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

    await screen.findByText('Reveal reading');
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

    await screen.findByText('Reveal reading');
    expect(screen.queryByText('💡 Sounds like "yomu".')).not.toBeInTheDocument();
    const showButton = await screen.findByRole('button', { name: 'Show mnemonic' });

    await user.click(showButton);
    expect(screen.getByText('💡 Sounds like "yomu".')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reveal reading' }));
    await user.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(async () => {
      const review = (await db.reviews.toArray())[0];
      expect(review?.assistance).toEqual(['mnemonic_shown']);
    });
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

    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByText('本を読みます。')).toBeInTheDocument();
    expect(screen.getByText('I read a book.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
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

      await user.click(screen.getByRole('button', { name: 'Reveal' }));
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
      await user.click(screen.getByRole('button', { name: 'Reveal' }));
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
});
