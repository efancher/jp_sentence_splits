import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import {
  ensureGrammarPattern,
  ensureGrammarRelationship,
  ensureGrammarStudyItem,
  ensureSentenceGrammar,
  getDb,
  updateSettings,
} from '../src/db/repository';
import {
  conjugate,
  conjugationFormsForWordClass,
  type ConjugationWordClass,
} from '../src/lib/conjugation';
import { ALIGNMENT_VERSION } from '../src/lib/analysisApi';
import { buildGrammarCompletionChoices } from '../src/lib/grammarPatterns';
import { createId, hashString } from '../src/lib/ids';
import { segmentIntoMorae } from '../src/lib/mora';
import { nativeAudioController } from '../src/lib/nativeAudio';
import {
  pitchPatternLabel,
  possiblePitchPatternsForMoraCount,
  type PitchAccentPattern,
} from '../src/lib/pitchAccentShape';
import { ReviewPage } from '../src/pages/ReviewPage';
import { withAppProviders } from '../src/test/providers';

/**
 * Mirrors ReviewPage's private pickTransformationTarget (not exported —
 * this file only imports the page component, matching this suite's
 * existing convention) so tests can assert against whichever form the
 * per-word hash actually picks, rather than assuming it's always plain
 * past now that the quizzed form varies by word (see ReviewPage.tsx).
 */
function expectedTransformation(
  expression: string,
  reading: string,
  vocabularyItemId: string,
  wordClass: ConjugationWordClass,
) {
  const forms = conjugationFormsForWordClass(wordClass);
  const startIndex = Number.parseInt(hashString(vocabularyItemId), 16) % forms.length;
  for (let offset = 0; offset < forms.length; offset += 1) {
    const form = forms[(startIndex + offset) % forms.length]!;
    const target = conjugate(expression, reading, wordClass, form.key);
    if (!target) continue;
    if (target.expression === expression && target.reading === reading) continue;
    return { formLabel: form.label, target };
  }
  throw new Error('No usable conjugation form found for test fixture');
}

// Mirrors ReviewPage's private PITCH_ACCENT_PATTERN_LABELS (not exported,
// same "this file only imports the page component" convention noted above).
const PITCH_ACCENT_DISPLAY_LABELS: Record<PitchAccentPattern, string> = {
  heiban: 'Heiban (平板)',
  atamadaka: 'Atamadaka (頭高)',
  nakadaka: 'Nakadaka (中高)',
  odaka: 'Odaka (尾高)',
};

/** Mirrors ReviewPage's private getPitchAccentReviewCandidates's per-candidate computation, for asserting against whichever label/choice order it actually produces. */
function expectedPitchAccentCandidate(
  reading: string,
  position: number,
  vocabularyItemId: string,
) {
  const moraCount = segmentIntoMorae(reading).length;
  const correctLabel = pitchPatternLabel(position, moraCount);
  const choices = [...possiblePitchPatternsForMoraCount(moraCount)].sort((a, b) => {
    const ha = Number.parseInt(hashString(`${vocabularyItemId}:order:${a}`), 16);
    const hb = Number.parseInt(hashString(`${vocabularyItemId}:order:${b}`), 16);
    return ha - hb;
  });
  return { moraCount, correctLabel, choices };
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

    const { formLabel, target } = expectedTransformation('話す', 'はなす', 'vocab-hanasu', 'godan');

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText(`Conjugate to: ${formLabel}`);
    expect(screen.getByText('話す')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Type the conjugated reading'), target.reading);
    await user.click(screen.getByRole('button', { name: 'Check' }));

    expect(screen.getByText('✓ Correct')).toBeInTheDocument();
    expect(screen.getByText(target.expression)).toBeInTheDocument();
    expect(screen.getByText(target.reading)).toBeInTheDocument();
    expect(screen.getByText('to speak')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
    const [review] = await db.reviews.toArray();
    expect(review?.responseRaw).toBe(target.reading);
    expect(review?.expectedAnswer).toBe(target.reading);

    const studyItems = await db.studyItems
      .where('subjectId')
      .equals('vocab-hanasu')
      .toArray();
    const transformationItem = studyItems.find(
      (item) => item.activityType === 'sentence_transformation',
    );
    expect(transformationItem?.subjectType).toBe('vocabularyItem');
  });

  it('quizzes a different word on whichever form its own id hashes to, deterministically', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');

    await db.vocabularyItems.add({
      id: 'vocab-tabeta',
      expression: '食べる',
      reading: 'たべる',
      meaning: 'to eat',
      partOfSpeech: 'v1',
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-tabeta',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-tabeta',
      surfaceForm: '食べる',
      createdAt: now,
      updatedAt: now,
    });
    await suppressVocabularyActivityTypes('vocab-tabeta');

    const { formLabel, target } = expectedTransformation(
      '食べる',
      'たべる',
      'vocab-tabeta',
      'ichidan',
    );

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText(`Conjugate to: ${formLabel}`);
    expect(screen.getByLabelText('Type the conjugated reading')).toBeInTheDocument();

    // Confirms the pick is stable across a fresh mount too — same word,
    // same hash, same form, not re-rolled on every render.
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Type the conjugated reading'), target.reading);
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByText('✓ Correct')).toBeInTheDocument();
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

  it('renders a pitch-accent card, grades the chosen pattern, and records the review', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');

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

    const { correctLabel } = expectedPitchAccentCandidate('はな', 1, 'vocab-hana');

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('Which pitch pattern?');
    expect(screen.getByText('はな')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: PITCH_ACCENT_DISPLAY_LABELS[correctLabel] }),
    );

    expect(screen.getByText('✓ Correct')).toBeInTheDocument();
    expect(screen.getByText('flower')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Good' }));

    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
    const [review] = await db.reviews.toArray();
    expect(review?.responseRaw).toBe(correctLabel);
    expect(review?.expectedAnswer).toBe(correctLabel);
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

    const { correctLabel, choices } = expectedPitchAccentCandidate('はな', 1, 'vocab-hana2');
    const wrongLabel = choices.find((choice) => choice !== correctLabel)!;

    const user = userEvent.setup();
    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('Which pitch pattern?');
    await user.click(
      screen.getByRole('button', { name: PITCH_ACCENT_DISPLAY_LABELS[wrongLabel] }),
    );

    expect(screen.getByText('✗ Not quite')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Again' }));

    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
    const [review] = await db.reviews.toArray();
    expect(review?.responseRaw).toBe(wrongLabel);
    expect(review?.expectedAnswer).toBe(correctLabel);
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

  it('excludes odaka/nakadaka as choices for a 1-mora word', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');

    // 目 (め) — 1 mora: only heiban/atamadaka are reachable.
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

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('Which pitch pattern?');
    expect(
      screen.getByRole('button', { name: PITCH_ACCENT_DISPLAY_LABELS.heiban }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: PITCH_ACCENT_DISPLAY_LABELS.atamadaka }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: PITCH_ACCENT_DISPLAY_LABELS.nakadaka }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: PITCH_ACCENT_DISPLAY_LABELS.odaka }),
    ).not.toBeInTheDocument();
  });

  it('excludes nakadaka but includes odaka as a choice for a 2-mora word', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await suppressUnconditionalSentenceActivityTypes('sent-1');

    // 花 (はな) — 2 morae: heiban/atamadaka/odaka reachable, not nakadaka.
    await db.vocabularyItems.add({
      id: 'vocab-hana3',
      expression: '花',
      reading: 'はな',
      meaning: 'flower',
      partOfSpeech: 'n',
      pitchAccentPositions: [1],
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-hana3',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-hana3',
      surfaceForm: '花',
      createdAt: now,
      updatedAt: now,
    });
    await suppressVocabularyActivityTypes('vocab-hana3');

    renderReviewPage('/books/book-1/review', 'books/:bookId/review');

    await screen.findByText('Which pitch pattern?');
    expect(
      screen.getByRole('button', { name: PITCH_ACCENT_DISPLAY_LABELS.odaka }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: PITCH_ACCENT_DISPLAY_LABELS.nakadaka }),
    ).not.toBeInTheDocument();
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

  it('renders word-by-word karaoke text plus the original sentence once alignment is cached (follow-up)', async () => {
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
    // Pre-cache alignment so KaraokeSentenceText never has to hit the
    // (unreachable, in tests) forced-alignment service.
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

    // Karaoke words render, and so does the original sentence text
    // underneath (a cross-check reference, since the aligner's own tokens
    // can diverge from/garble the real sentence — e.g. `<unk>` tokens).
    expect(await screen.findByText('本を')).toBeInTheDocument();
    expect(screen.getByText('読みます')).toBeInTheDocument();
    expect(screen.getByText('本を読みます。')).toBeInTheDocument();
  });

  it('shows a flagged placeholder instead of a literal <unk> token from the aligner', async () => {
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

    await screen.findByText('読みます');
    expect(screen.queryByText('<unk>')).not.toBeInTheDocument();
    expect(screen.getByText('?')).toBeInTheDocument();
    // The original sentence text is still shown in full, unaffected.
    expect(screen.getByText('本を読みます。')).toBeInTheDocument();
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
    await screen.findByText('Reveal reading');
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
});
