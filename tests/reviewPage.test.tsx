import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import * as repository from '../src/db/repository';
import {
  ensureGrammarPattern,
  ensureSentenceGrammar,
  ensureStudyItem,
  getDb,
  setBookSuspended,
  updateSettings,
} from '../src/db/repository';
import { ALIGNMENT_VERSION } from '../src/lib/analysisApi';
import { PITCH_TRACK_VERSION } from '../src/lib/pitch';
import { createId } from '../src/lib/ids';
import { segmentIntoMorae } from '../src/lib/mora';
import { nativeAudioController } from '../src/lib/nativeAudio';
import {
  pickMissedReadingTarget,
  pickStructureCheckChunk,
  ReviewPage,
  spaceOutSiblingCards,
} from '../src/pages/ReviewPage';
import type { AnalysisChunk } from '../src/domain/types';
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
  // 4+ mora words go through PitchAccentCard's coarse half-picker before the
  // individual fall-position buttons render — see the pitch_accent card's
  // "long word" scaffold (report-pitch-drill-effectiveness.ts, 2026-09-27).
  const halfwayPosition = Math.floor(morae.length / 2);
  const halfLabel =
    morae.length < 4
      ? null
      : correctPosition > halfwayPosition
        ? `Falls later — mora ${halfwayPosition + 1} or beyond`
        : `Doesn’t fall, or falls by mora ${halfwayPosition}`;
  return { morae, correctPosition, label: caption(correctPosition), caption, halfLabel };
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
    // Started in the book, so the sentence counts as introduced and Review serves its cards.
    status: 'in_progress',
    addedAt: now,
  });
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
 * Seeds a far-future `reading_in_context` study item for `sentenceId` so the
 * sole sentence-subject activity type never occupies the queue — used by
 * tests that want to isolate a conditional card type (vocabulary-target or
 * listening) instead.
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
  await db.studyItems.add({
    id: `si-${sentenceId}-reading_in_context`,
    subjectType: 'sentence',
    subjectId: sentenceId,
    activityType: 'reading_in_context',
    fsrsState: farFutureFsrsState,
    createdAt: now,
    updatedAt: now,
  });
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
      expect(await getDb().studyItems.count()).toBe(1); // reading_in_context only
    });
  });

  it('holds a suspended book out of the global queue but not its own book review', async () => {
    await seedBookWithSentence();

    const globalBefore = renderReviewPage('/review', '/review');
    expect(await screen.findByText('本を読みます。')).toBeInTheDocument();
    globalBefore.unmount();

    await setBookSuspended('book-1', true);

    const globalAfter = renderReviewPage('/review', '/review');
    expect(
      await screen.findByText('No sentences to review here yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('本を読みます。')).not.toBeInTheDocument();
    globalAfter.unmount();

    // The book's own review page is an explicit opt-in — still shows its cards.
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');
    expect(await screen.findByText('本を読みます。')).toBeInTheDocument();
  });

  it('a sentence-pinned "deep dive" (?sentenceId=) pulls in a not-yet-due new-state card the plain queue withholds (docs/ROADMAP.md "Opt-in single-sentence deep dive")', async () => {
    await seedBookWithSentence();
    const item = await ensureStudyItem('sentence', 'sent-1', 'reading_in_context');
    await getDb().studyItems.update(item.id, {
      fsrsState: { ...item.fsrsState, due: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
    });

    const plain = renderReviewPage('/review', '/review');
    expect(await screen.findByText('All caught up.')).toBeInTheDocument();
    expect(screen.queryByText('本を読みます。')).not.toBeInTheDocument();
    plain.unmount();

    renderReviewPage('/review?sentenceId=sent-1', '/review');
    expect(await screen.findByText('本を読みます。')).toBeInTheDocument();
  });

  it('links "Why?" to the current card\'s study-item debug page (Phase 7.10)', async () => {
    await seedBookWithSentence();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('本を読みます。');
    const studyItem = await waitFor(async () => {
      const items = await getDb().studyItems.where('subjectId').equals('sent-1').toArray();
      const sentenceItem = items.find((item) => item.activityType === 'reading_in_context');
      expect(sentenceItem).toBeDefined();
      return sentenceItem!;
    });
    expect(screen.getByRole('link', { name: 'Why?' })).toHaveAttribute(
      'href',
      `/study-items/${studyItem.id}`,
    );
  });

  it('rates a card, advances the queue, and records a review', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    // A second sentence so the queue has somewhere to advance to.
    await db.sentences.add({
      id: 'sent-2',
      normalizedKey: 'sent-2',
      japanese: '水を飲みます。',
      readingOnly: '',
      inlineReading: '',
      translation: 'I drink water.',
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
      status: 'in_progress',
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
    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('本を読みます。');
    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    await user.click(screen.getByRole('button', { name: 'Good' }));

    // Queue advances to the second sentence's card.
    await screen.findByText('水を飲みます。');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reveal' })).toBeInTheDocument();
    });

    await waitFor(async () => {
      expect(await getDb().reviews.count()).toBe(1);
    });
    // Sentence-level cards are not part of the chapter-layout comparison.
    expect((await getDb().reviews.toArray())[0]?.presentation).toBeUndefined();
  });

  it('sentence-led flow: shows 4 rotating meaning choices, explains a wrong pick, and stores the choice record', async () => {
    await seedBookWithSentence();
    const db = getDb();
    await db.bookSentences.update('bs-1', { status: 'in_progress' });
    await db.analyses.update('sent-1', {
      comprehensionCheck: {
        options: [
          'I read a book.',
          'I do not read a book.',
          'I wrote a book.',
          'I will read a book.',
        ],
        correctIndex: 0,
        extraDistractors: ['I bought a book.', 'He reads a book.', 'I am reading a magazine.'],
        provenance: 'manual',
        createdAt: new Date().toISOString(),
      },
    });
    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('本を読みます。');
    const pickable = await screen.findAllByRole('button', { name: /^(I |He )/ });
    expect(pickable).toHaveLength(4);
    expect(screen.getAllByText('I read a book.')).toHaveLength(1);
    const wrong = pickable.find((button) => button.textContent !== 'I read a book.')!;
    await user.click(wrong);
    expect(await screen.findByText(/It means:/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /guided gloss/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    await user.click(screen.getByRole('button', { name: 'Again' }));

    await waitFor(async () => {
      const review = (await getDb().reviews.toArray())[0];
      expect(review?.meaningChoice?.correct).toBe(false);
      expect(review?.meaningChoice?.chosenText).toBe(wrong.textContent);
      expect(review?.meaningChoice?.shown).toHaveLength(4);
      expect(review?.meaningChoice?.shown[review.meaningChoice.chosenIndex]).toBe(wrong.textContent);
    });
  });

  it('waits for active-card history, rotates past choices, and loads fresh evidence on advance', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const check = {
      options: ['I read a book.', 'I do not read a book.', 'I wrote a book.', 'I will read a book.'],
      correctIndex: 0,
      extraDistractors: ['I bought a book.', 'He reads a book.', 'I am reading a magazine.'],
      provenance: 'manual' as const,
      createdAt: new Date().toISOString(),
    };
    await db.sentences.update('sent-1', { inlineReading: '本[ほん]を読[よ]みます。' });
    await db.sentences.put({ ...(await db.sentences.get('sent-1'))!, id: 'sent-2', normalizedKey: 'sent-2', firstOccurrenceIndex: 1 });
    await db.analyses.update('sent-1', { comprehensionCheck: check });
    await db.analyses.put({ ...(await db.analyses.get('sent-1'))!, sentenceId: 'sent-2' });
    const first = await ensureStudyItem('sentence', 'sent-1', 'reading_in_context');
    const second = await ensureStudyItem('sentence', 'sent-2', 'reading_in_context');
    await db.studyItems.update(first.id, { fsrsState: { ...first.fsrsState, due: '2026-01-01T00:00:00.000Z' } });
    await db.studyItems.update(second.id, { fsrsState: { ...second.fsrsState, due: '2026-01-02T00:00:00.000Z' } });
    await db.reviews.add({
      id: 'earlier', studyItemId: first.id, timestamp: '2025-12-31T00:00:00.000Z', rating: 'good',
      missedReadings: ['本'],
      meaningChoice: { shown: check.options, chosenIndex: 0, chosenText: check.options[0]!, correctText: check.options[0]!, correct: true, qualifying: true },
    });
    const readHistory = repository.getSentenceReviewHistory;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const historyRead = vi.spyOn(repository, 'getSentenceReviewHistory')
      .mockImplementationOnce(async (id) => { await held; return readHistory(id); });
    try {
      const user = userEvent.setup();
      renderReviewPage('/review', '/review');
      await waitFor(() => expect(historyRead).toHaveBeenCalledWith('sent-1'));
      expect(screen.queryByRole('button', { name: 'I read a book.', exact: true })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument();
      await act(async () => { release(); });
      await user.type(await screen.findByLabelText('Type the reading of the highlighted part'), 'ほん');
      await user.click(screen.getByRole('button', { name: 'Check', exact: true }));
      for (const text of check.extraDistractors) expect(screen.getByRole('button', { name: text, exact: true })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'I read a book.', exact: true }));
      await user.click(screen.getByRole('button', { name: 'Reveal' }));
      await user.click(screen.getByRole('button', { name: 'Good' }));
      await screen.findByRole('button', { name: 'I read a book.', exact: true });
      expect(historyRead.mock.calls.map(([id]) => id)).toEqual(['sent-1', 'sent-2']);
      expect(screen.queryByLabelText('Type the reading of the highlighted part')).not.toBeInTheDocument();
      const choices = screen.getAllByRole('button', { name: /^(I |He )/ }).map((button) => button.textContent);
      // A concurrent history arrival must not replace an already displayed prompt.
      await act(async () => { await db.reviews.add({ id: 'arrived', studyItemId: second.id, timestamp: new Date().toISOString(), rating: 'again', missedReadings: ['本'] }); });
      expect(screen.queryByLabelText('Type the reading of the highlighted part')).not.toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /^(I |He )/ }).map((button) => button.textContent)).toEqual(choices);
      expect(await db.reviews.where('studyItemId').equals(first.id).count()).toBe(2);
    } finally {
      release();
      historyRead.mockRestore();
    }
  });

  it("asks for the typed reading of the sentence's weakest word on its second review, and keeps the rating explicit", async () => {
    await seedBookWithSentence();
    const db = getDb();
    await db.sentences.update('sent-1', { inlineReading: '本[ほん]を読[よ]みます。' });
    const item = await ensureStudyItem('sentence', 'sent-1', 'reading_in_context');
    await db.studyItems.update(item.id, {
      fsrsState: { ...item.fsrsState, reps: 1, state: 'review', due: '2026-01-01T00:00:00.000Z' },
    });
    // 本 keeps failing as a word card, so it is the sentence's weakest word.
    const word = await repository.ensureVocabularyItem('本', 'ほん');
    await db.sentenceVocabulary.put({
      id: 'sv-weak',
      sentenceId: 'sent-1',
      vocabularyItemId: word.id,
      surfaceForm: '本',
    } as never);
    const wordItem = await ensureStudyItem('vocabularyItem', word.id, 'reading_retrieval');
    for (let i = 0; i < 3; i += 1) {
      await db.reviews.add({ id: `fail-${i}`, studyItemId: wordItem.id, timestamp: new Date().toISOString(), rating: 'again' });
    }

    const user = userEvent.setup();
    renderReviewPage('/review', '/review');
    await user.type(await screen.findByLabelText('Type the reading of the highlighted part'), 'ほん');
    await user.click(screen.getByRole('button', { name: 'Check', exact: true }));
    await user.click(await screen.findByRole('button', { name: 'Reveal' }));
    // The typed result never picks the rating: the learner still chooses.
    expect(await db.reviews.where('studyItemId').equals(item.id).count()).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Hard' }));

    await waitFor(async () => {
      const saved = await db.reviews.where('studyItemId').equals(item.id).toArray();
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ rating: 'hard', responseRaw: 'ほん', expectedAnswer: 'ほん' });
    });
  });

  it('offers a retry instead of presenting a card with missing history after a read failure', async () => {
    await seedBookWithSentence();
    await ensureStudyItem('sentence', 'sent-1', 'reading_in_context');
    const historyRead = vi.spyOn(repository, 'getSentenceReviewHistory')
      .mockRejectedValueOnce(new Error('Synthetic IndexedDB failure'));
    try {
      const user = userEvent.setup();
      renderReviewPage('/review', '/review');
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this card's review history.");
      expect(screen.queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      await screen.findByRole('button', { name: 'Reveal' });
      expect(historyRead).toHaveBeenCalledTimes(2);
      expect(await getDb().reviews.count()).toBe(0);
    } finally {
      historyRead.mockRestore();
    }
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
    // The passage neighbours must themselves be ready for full review
    // (vocab confirmed, nothing un-proficient linked) or the
    // reading_in_context card is withheld — see the dedicated gate test
    // below. Suppress their own sentence-subject cards too so sent-1's
    // card is the one under test.
    for (const id of ['sent-0', 'sent-2']) {
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
      await suppressUnconditionalSentenceActivityTypes(id);
    }

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

  it('highlights a tracked grammar pattern recurring in the reading_in_context passage (docs/ROADMAP.md "ambient connective tissue")', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await db.sentences.add({
      id: 'sent-0',
      normalizedKey: 'sent-0',
      japanese: 'それは訳がないでしょう。',
      readingOnly: '',
      inlineReading: '',
      translation: 'There is no reason for that.',
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
      id: 'bs-0',
      bookId: 'book-1',
      sentenceId: 'sent-0',
      position: -1,
      status: 'unstarted',
      addedAt: now,
    });
    await db.analyses.add({
      sentenceId: 'sent-0',
      chunks: [],
      notes: '',
      status: 'empty',
      formatVersion: 2,
      vocabularyReviewStatus: 'confirmed',
      vocabularySelections: [],
      createdAt: now,
      updatedAt: now,
    });
    await suppressUnconditionalSentenceActivityTypes('sent-0');

    const pattern = await ensureGrammarPattern('〜わけがない', {
      shortMeaning: 'no reason to think that',
    });
    // それは訳がないでしょう。 — 訳がない sits at chars [3, 7).
    await ensureSentenceGrammar('sent-0', pattern.id, {
      surfaceForm: '訳がない',
      start: 3,
      end: 7,
      confirmedByLearner: true,
    });

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('本を読みます。');
    const mark = await screen.findByText('訳がない');
    expect(mark.tagName).toBe('MARK');
    expect(mark).toHaveAttribute('title', '〜わけがない');
  });

  it('does not highlight anything in the passage when no context sentence has a tracked pattern', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await db.sentences.add({
      id: 'sent-0',
      normalizedKey: 'sent-0',
      japanese: 'それは訳がないでしょう。',
      readingOnly: '',
      inlineReading: '',
      translation: 'There is no reason for that.',
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
      id: 'bs-0',
      bookId: 'book-1',
      sentenceId: 'sent-0',
      position: -1,
      status: 'unstarted',
      addedAt: now,
    });
    await db.analyses.add({
      sentenceId: 'sent-0',
      chunks: [],
      notes: '',
      status: 'empty',
      formatVersion: 2,
      vocabularyReviewStatus: 'confirmed',
      vocabularySelections: [],
      createdAt: now,
      updatedAt: now,
    });
    await suppressUnconditionalSentenceActivityTypes('sent-0');

    const { container } = renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('それは訳がないでしょう。');
    expect(container.querySelector('mark')).not.toBeInTheDocument();
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

  it('does not seed a pitch-accent card while pitch accent is paused (2026-09-28)', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await addReferenceAudio('sent-1');
    await updateSettings({ pitchAccentPaused: true });

    await db.vocabularyItems.add({
      id: 'vocab-hana-paused',
      expression: '花',
      reading: 'はな',
      meaning: 'flower',
      partOfSpeech: 'n',
      pitchAccentPositions: [1],
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-hana-paused',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-hana-paused',
      surfaceForm: '花',
      createdAt: now,
      updatedAt: now,
    });
    await suppressVocabularyActivityTypes('vocab-hana-paused');
    await suppressAudioCards('sent-1', 'sv-hana-paused');

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    // Everything else in this sentence's scope is deliberately suppressed
    // (matching the equivalent unpaused test above), so with pitch_accent
    // also withheld, nothing is left to show.
    await screen.findByText('All caught up.');
    const studyItems = await db.studyItems
      .where('subjectId')
      .equals('vocab-hana-paused')
      .toArray();
    expect(studyItems.some((item) => item.activityType === 'pitch_accent')).toBe(false);
  });

  it('seeds and renders a pitch-accent-production card for a proficient sentence with no reference audio', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    // No addReferenceAudio('sent-1') — pitch_accent_production is eligible
    // *because* there's no reference recording (the complement of the
    // perception pitch_accent card's eligibility).

    await db.vocabularyItems.add({
      id: 'vocab-hana-production',
      expression: '花',
      reading: 'はな',
      meaning: 'flower',
      partOfSpeech: 'n',
      pitchAccentPositions: [1],
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-hana-production',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-hana-production',
      surfaceForm: '花',
      createdAt: now,
      updatedAt: now,
    });
    // Also grants the word FSRS proficiency (state 'review'), which
    // getSentenceFullReviewReadiness requires before pitch_accent_production
    // (or any full-sentence card) is eligible.
    await suppressVocabularyActivityTypes('vocab-hana-production');

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByRole('button', { name: 'Record' });
    expect(screen.getByText('本を読みます。')).toBeInTheDocument();

    await waitFor(async () => {
      const sentenceItems = await db.studyItems.where('subjectId').equals('sent-1').toArray();
      const productionItem = sentenceItems.find(
        (item) => item.activityType === 'pitch_accent_production',
      );
      expect(productionItem).toBeDefined();
      expect(productionItem?.subjectType).toBe('sentence');
    });
  });

  it('does not seed a pitch-accent-production card while pitch accent is paused, even though it would otherwise be eligible (2026-09-28)', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await updateSettings({ pitchAccentPaused: true });

    await db.vocabularyItems.add({
      id: 'vocab-hana-production-paused',
      expression: '花',
      reading: 'はな',
      meaning: 'flower',
      partOfSpeech: 'n',
      pitchAccentPositions: [1],
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-hana-production-paused',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-hana-production-paused',
      surfaceForm: '花',
      createdAt: now,
      updatedAt: now,
    });
    await suppressVocabularyActivityTypes('vocab-hana-production-paused');

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    // Everything else in this sentence's scope is deliberately suppressed
    // (matching the base "seeds and renders" test above), so with
    // pitch_accent_production also withheld, nothing is left to show.
    await screen.findByText('All caught up.');
    const sentenceItems = await db.studyItems.where('subjectId').equals('sent-1').toArray();
    expect(sentenceItems.some((item) => item.activityType === 'pitch_accent_production')).toBe(
      false,
    );
  });

  it('seeds an edge-accent (odaka) pitch card when a particle follows the word', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await addReferenceAudio('sent-1');
    // Same 下手 [2], but now followed by は — the downstep has somewhere to land.
    await db.sentences.update('sent-1', { japanese: '下手は下手なりに頑張る。' });

    await db.vocabularyItems.add({
      id: 'vocab-heta-ok',
      expression: '下手',
      reading: 'へた',
      meaning: 'unskillful',
      partOfSpeech: 'adj-na',
      pitchAccentPositions: [2],
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-heta-ok',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-heta-ok',
      surfaceForm: '下手',
      createdAt: now,
      updatedAt: now,
    });
    await suppressVocabularyActivityTypes('vocab-heta-ok');
    await suppressAudioCards('sent-1', 'sv-heta-ok');

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText(/Listen, then mark where it falls/);
    await waitFor(async () => {
      const studyItems = await db.studyItems
        .where('subjectId')
        .equals('vocab-heta-ok')
        .toArray();
      expect(studyItems.some((item) => item.activityType === 'pitch_accent')).toBe(true);
    });
  });

  it('seeds a pitch-accent card for a godan negative occurrence, graded against the conjugated reading', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await addReferenceAudio('sent-1');
    // 走る [2] is accented; its negative 走らない gets a downstep right
    // before ない (Wiktionary Module:ja-acc-table, pitchAccentShift.ts) —
    // 5 morae (は/し/ら/な/い), drop after mora 3, one mora past the
    // citation stem boundary, not at it.
    await db.sentences.update('sent-1', { japanese: '公園を走らない。' });

    await db.vocabularyItems.add({
      id: 'vocab-hashiru',
      expression: '走る',
      reading: 'はしる',
      meaning: 'to run',
      partOfSpeech: 'v5r; vi',
      pitchAccentPositions: [2],
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-hashiru',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-hashiru',
      surfaceForm: '走らない',
      createdAt: now,
      updatedAt: now,
    });
    await suppressVocabularyActivityTypes('vocab-hashiru');
    await suppressAudioCards('sent-1', 'sv-hashiru');
    // 走らない is also a valid sentence_transformation candidate (conjugable
    // verb) — suppress it so the queue surfaces the pitch-accent card
    // under test instead.
    await db.studyItems.add({
      id: 'si-sv-hashiru-sentence_transformation',
      subjectType: 'sentenceVocabulary',
      subjectId: 'sv-hashiru',
      activityType: 'sentence_transformation',
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

    const { label, correctPosition, halfLabel } = expectedPitchAccentDrop('はしらない', 3);

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText(/Listen, then mark where it falls/);
    // The reading line and mora choices must reflect the conjugated はしらない,
    // not the dictionary はしる — otherwise the looped audio disagrees with
    // the card.
    expect(screen.getByText('はしらない')).toBeInTheDocument();

    if (halfLabel) {
      await user.click(screen.getByRole('button', { name: halfLabel }));
    }
    await user.click(screen.getByRole('button', { name: label }));

    expect(screen.getByText('✓ Correct')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
    const [review] = await db.reviews.toArray();
    expect(review?.responseRaw).toBe(String(correctPosition));
    expect(review?.expectedAnswer).toBe(String(correctPosition));
    expect(review?.errorClassification).toBeUndefined();
  });

  it('seeds a pitch-accent card for an ichidan negative occurrence, graded against the conjugated reading', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await addReferenceAudio('sent-1');
    // 食べる [2] is accented; unlike godan, an ichidan verb's negative stays
    // at the UNCHANGED citation position (Wiktionary Module:ja-acc-table,
    // pitchAccentShift.ts) — 食べない, 4 morae (た/べ/な/い), drop after mora 2.
    await db.sentences.update('sent-1', { japanese: '朝ご飯を食べない。' });

    await db.vocabularyItems.add({
      id: 'vocab-taberu',
      expression: '食べる',
      reading: 'たべる',
      meaning: 'to eat',
      partOfSpeech: 'v1',
      pitchAccentPositions: [2],
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-taberu',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-taberu',
      surfaceForm: '食べない',
      createdAt: now,
      updatedAt: now,
    });
    await suppressVocabularyActivityTypes('vocab-taberu');
    await suppressAudioCards('sent-1', 'sv-taberu');
    await db.studyItems.add({
      id: 'si-sv-taberu-sentence_transformation',
      subjectType: 'sentenceVocabulary',
      subjectId: 'sv-taberu',
      activityType: 'sentence_transformation',
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

    const { label, correctPosition, halfLabel } = expectedPitchAccentDrop('たべない', 2);

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText(/Listen, then mark where it falls/);
    expect(screen.getByText('たべない')).toBeInTheDocument();

    if (halfLabel) {
      await user.click(screen.getByRole('button', { name: halfLabel }));
    }
    await user.click(screen.getByRole('button', { name: label }));

    expect(screen.getByText('✓ Correct')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
    const [review] = await db.reviews.toArray();
    expect(review?.responseRaw).toBe(String(correctPosition));
    expect(review?.expectedAnswer).toBe(String(correctPosition));
    expect(review?.errorClassification).toBeUndefined();
  });

  it('seeds a pitch-accent card for an i-adjective polite (です) occurrence, graded against the conjugated reading', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await addReferenceAudio('sent-1');
    // 甘い [0] is heiban; its です form is NOT flat — 甘いです gains a
    // downstep at citationMoraCount - 1 (Wiktionary Module:ja-acc-table,
    // pitchAccentShift.ts) — 5 morae (あ/ま/い/で/す), drop after mora 2.
    await db.sentences.update('sent-1', { japanese: 'このケーキは甘いです。' });

    await db.vocabularyItems.add({
      id: 'vocab-amai',
      expression: '甘い',
      reading: 'あまい',
      meaning: 'sweet',
      partOfSpeech: 'adj-i',
      pitchAccentPositions: [0],
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-amai',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-amai',
      surfaceForm: '甘いです',
      createdAt: now,
      updatedAt: now,
    });
    await suppressVocabularyActivityTypes('vocab-amai');
    await suppressAudioCards('sent-1', 'sv-amai');
    await db.studyItems.add({
      id: 'si-sv-amai-sentence_transformation',
      subjectType: 'sentenceVocabulary',
      subjectId: 'sv-amai',
      activityType: 'sentence_transformation',
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

    const { label, correctPosition, halfLabel } = expectedPitchAccentDrop('あまいです', 2);

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText(/Listen, then mark where it falls/);
    expect(screen.getByText('あまいです')).toBeInTheDocument();

    if (halfLabel) {
      await user.click(screen.getByRole('button', { name: halfLabel }));
    }
    await user.click(screen.getByRole('button', { name: label }));

    expect(screen.getByText('✓ Correct')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
    const [review] = await db.reviews.toArray();
    expect(review?.responseRaw).toBe(String(correctPosition));
    expect(review?.expectedAnswer).toBe(String(correctPosition));
    expect(review?.errorClassification).toBeUndefined();
  });

  it('offers one fall-position choice per mora plus "no fall" for a 1-mora word', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');
    await addReferenceAudio('sent-1');
    // 目 is odaka-shaped (1-mora [1]); the card only surfaces when a particle
    // follows for the downstep to land on.
    await db.sentences.update('sent-1', { japanese: '目が赤いです。' });

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
    // 4 morae: the coarse half-picker gates the individual fall-position
    // buttons (the "long word" scaffold, report-pitch-drill-effectiveness.ts,
    // 2026-09-27) — mora 2 and mora 3 sit either side of the halfway split.
    expect(screen.queryByRole('button', { name: 'Falls after mora 2' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Falls after mora 3' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Doesn’t fall, or falls by mora 2' }));
    expect(screen.getByRole('button', { name: 'Falls after mora 2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Falls after mora 3' })).not.toBeInTheDocument();

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

  it('shows the measured native-clip pitch contour on the listening reveal when a track is cached', async () => {
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
    // jsdom can't decode audio, so seed the cache the overlay reads from.
    await db.referencePitchTracks.put({
      id: 'audio-1',
      pitchVersion: PITCH_TRACK_VERSION,
      computedAt: now,
      payload: {
        medianHz: 140,
        voicedRatio: 1,
        durationSeconds: 0.08,
        frames: [0, 2, 3, 1].map((relativeSemitones, index) => ({
          timeSeconds: index * 0.02,
          hz: 140,
          voiced: true,
          confidence: 0.9,
          relativeSemitones,
        })),
      },
    });

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByRole('button', { name: /Play native sentence recording/ });
    await user.click(screen.getByRole('button', { name: 'Reveal text' }));
    await user.click(screen.getByRole('button', { name: 'Reveal translation' }));

    expect(
      await screen.findByLabelText('Measured pitch of the native recording'),
    ).toBeInTheDocument();
  });

  it('shows the measured native pitch contour on a non-audio card reveal when the sentence has a reference clip', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await addReferenceAudio('sent-1');
    // jsdom can't decode audio, so seed the cache the contour reads from.
    await db.referencePitchTracks.put({
      id: 'audio-sent-1',
      pitchVersion: PITCH_TRACK_VERSION,
      computedAt: now,
      payload: {
        medianHz: 140,
        voicedRatio: 1,
        durationSeconds: 0.08,
        frames: [0, 2, 3, 1].map((relativeSemitones, index) => ({
          timeSeconds: index * 0.02,
          hz: 140,
          voiced: true,
          confidence: 0.9,
          relativeSemitones,
        })),
      },
    });

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await user.click(await screen.findByRole('button', { name: 'Reveal' }));
    expect(
      await screen.findByLabelText('Measured pitch of the native recording'),
    ).toBeInTheDocument();
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
      expect(await db.studyItems.count()).toBe(1); // reading_in_context only
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
    // The lazy-seeding cap is the subject here; the daily top-ups deliberately sit outside it.
    await updateSettings({ newCardsPerSessionLimit: 1, dailyNewSentenceCardQuota: 0, dailyNewAudioCardQuota: 0 });
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
        status: 'in_progress',
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

    // Only sent-1's sentence card should seed (one "new subject" batch).
    await screen.findByText('本を読みます。');
    await waitFor(async () => {
      expect(await db.studyItems.count()).toBe(1);
    });

    await user.click(await screen.findByRole('button', { name: 'Reveal' }));
    await user.click(screen.getByRole('button', { name: 'Good' }));
    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });

    expect(
      await screen.findByText(/New-card limit reached for this session/),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 of 1 introduced/)).toBeInTheDocument();
    expect(screen.getByText(/2 more waiting next time/)).toBeInTheDocument();
    // sent-2/sent-3 never got seeded.
    expect(await db.studyItems.count()).toBe(1);
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

  // ---------------------------------------------------------------------
  // Grammar-pattern review: a 2-tier ladder (2026-09-22 recognition/
  // production split) — `grammar_recognition` (self-rated, entry rung,
  // seeded only via "Track" in GrammarPicker) gates `grammar_completion`
  // (typed production, lazily seeded by ReviewPage once recognition is
  // FSRS-proficient) — global scope only (no bookId), see
  // GRAMMAR_ACTIVITY_TYPES's doc comment in ReviewPage.tsx. These tests
  // pre-seed a *proficient* grammar_recognition item directly (mirroring
  // "Track" plus enough reps to graduate it) so grammar_completion is ready
  // to test on its own.
  // ---------------------------------------------------------------------

});

describe('spaceOutSiblingCards', () => {
  const card = (subjectId: string, activityType: string) =>
    ({
      studyItem: { subjectType: 'vocabularyItem', subjectId, activityType },
    }) as unknown as Parameters<typeof spaceOutSiblingCards>[0][number];
  const trace = (cards: ReturnType<typeof card>[]) =>
    spaceOutSiblingCards(cards).map(
      (c) => `${c.studyItem.subjectId}:${c.studyItem.activityType}`,
    );

  it('never places two cards for the same word adjacently when it can avoid it', () => {
    const order = trace([
      card('zettai', 'reading_retrieval'),
      card('zettai', 'cloze'),
      card('zettai', 'reading_production'),
      card('other-a', 'reading_retrieval'),
      card('other-b', 'reading_retrieval'),
    ]);
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i].split(':')[0]).not.toBe(order[i - 1].split(':')[0]);
    }
    expect(order).toHaveLength(5);
  });

  it('falls back to plain order when every remaining card is the same word', () => {
    expect(
      trace([
        card('zettai', 'reading_retrieval'),
        card('zettai', 'cloze'),
        card('zettai', 'reading_production'),
      ]),
    ).toEqual([
      'zettai:reading_retrieval',
      'zettai:cloze',
      'zettai:reading_production',
    ]);
  });

  it('keeps due order for non-siblings', () => {
    expect(
      trace([
        card('a', 'reading_retrieval'),
        card('b', 'reading_retrieval'),
        card('c', 'reading_retrieval'),
      ]),
    ).toEqual([
      'a:reading_retrieval',
      'b:reading_retrieval',
      'c:reading_retrieval',
    ]);
  });

});

describe('pickMissedReadingTarget', () => {
  const japanese = '私は猫が好きです。';
  const inlineReading = '私[わたし]は猫[ねこ]が好[す]きです。';

  it('returns the first flagged word with a derivable reading', () => {
    expect(pickMissedReadingTarget(['猫', '好き'], japanese, inlineReading)).toEqual({
      japanese: '猫',
      expectedReading: 'ねこ',
    });
  });

  it('skips words no longer in the sentence and falls through to undefined', () => {
    expect(pickMissedReadingTarget(['犬'], japanese, inlineReading)).toBeUndefined();
    expect(pickMissedReadingTarget(undefined, japanese, inlineReading)).toBeUndefined();
    expect(pickMissedReadingTarget([], japanese, inlineReading)).toBeUndefined();
  });
});

describe('pickStructureCheckChunk', () => {
  function chunk(overrides: Partial<AnalysisChunk>): AnalysisChunk {
    return {
      id: 'chunk-id',
      order: 0,
      japanese: '',
      role: '',
      literalEnglish: '',
      ...overrides,
    };
  }

  const inlineReading = '私[わたし]は猫[ねこ]が好[す]きです。';

  it('picks the first ambiguity-prone chunk in array order and derives its reading', () => {
    const chunks = [
      chunk({ id: 'c1', japanese: '私は', role: 'topic は' }),
      chunk({ id: 'c2', japanese: '猫が', role: 'Aが' }),
      chunk({ id: 'c3', japanese: '好きです', role: 'engine' }),
    ];
    expect(pickStructureCheckChunk(chunks, inlineReading)).toEqual({
      japanese: '私は',
      expectedReading: 'わたしは',
    });
  });

  it('skips a leading non-flagged chunk to find a later ambiguity-prone one', () => {
    const chunks = [
      chunk({ id: 'c1', japanese: '好きです', role: 'engine' }),
      chunk({ id: 'c2', japanese: '猫が', role: 'Aが' }),
    ];
    expect(pickStructureCheckChunk(chunks, inlineReading)).toEqual({
      japanese: '猫が',
      expectedReading: 'ねこが',
    });
  });

  it('returns undefined when no chunk has an ambiguity-prone role', () => {
    const chunks = [
      chunk({ id: 'c1', japanese: '好きです', role: 'engine' }),
      chunk({ id: 'c2', japanese: 'とても', role: 'adverb' }),
    ];
    expect(pickStructureCheckChunk(chunks, inlineReading)).toBeUndefined();
  });

  it('returns undefined when the sentence has no inlineReading yet', () => {
    const chunks = [chunk({ id: 'c1', japanese: '私は', role: 'topic は' })];
    expect(pickStructureCheckChunk(chunks, '')).toBeUndefined();
  });

  it('returns undefined when chunks is undefined', () => {
    expect(pickStructureCheckChunk(undefined, inlineReading)).toBeUndefined();
  });
});
