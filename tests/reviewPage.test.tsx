import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { ReviewPage } from '../src/pages/ReviewPage';
import { withAppProviders } from '../src/test/providers';

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

  it('renders reading_retrieval and cloze cards for the same target word, each seeded once (Phase 7.2/7.3)', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    const notDueYet = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const farFutureFsrsState = {
      due: notDueYet,
      stability: 1,
      difficulty: 1,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
      state: 'review' as const,
    };
    // Keep the two sentence-subject activity types out of the queue so only
    // the two vocabulary-subject cards seed/render in this test.
    for (const activityType of ['comprehension', 'reading_in_context']) {
      await db.studyItems.add({
        id: `si-${activityType}`,
        subjectType: 'sentence',
        subjectId: 'sent-1',
        activityType,
        fsrsState: farFutureFsrsState,
        createdAt: now,
        updatedAt: now,
      });
    }

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

    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(2);
    });
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
