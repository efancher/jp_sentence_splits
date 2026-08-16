import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { PracticePage } from '../src/pages/PracticePage';
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
    japanese: '電気を付けました。',
    readingOnly: '',
    inlineReading: '',
    translation: 'I turned on the light.',
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

function renderPracticePage(path: string) {
  return render(
    withAppProviders(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="books/:bookId/practice/:sentenceId"
            element={<PracticePage />}
          />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe('PracticePage natural-encounter panel (Phase 7.8)', () => {
  beforeEach(async () => {
    resetDbForTests(`practice-page-${createId('db')}`);
    await ensureSettings();
  });

  it('does not render the panel when the sentence has no materialized vocabulary', async () => {
    await seedBookWithSentence();
    renderPracticePage('/books/book-1/practice/sent-1');

    await screen.findByText('電気を付けました。');
    expect(screen.queryByText('Recognized these without hints?')).not.toBeInTheDocument();
  });

  it('records a natural-encounter review for a materialized vocabulary item and disables the row after rating', async () => {
    await seedBookWithSentence();
    const db = getDb();
    const now = new Date().toISOString();
    await db.vocabularyItems.add({
      id: 'vocab-tsukeru',
      expression: '付ける',
      reading: 'つける',
      meaning: 'to turn on (transitive)',
      createdAt: now,
      updatedAt: now,
    });
    await db.sentenceVocabulary.add({
      id: 'sv-1',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vocab-tsukeru',
      surfaceForm: '付け',
      createdAt: now,
      updatedAt: now,
    });

    const user = userEvent.setup();
    renderPracticePage('/books/book-1/practice/sent-1');

    await screen.findByText('Recognized these without hints?');
    expect(screen.getByText('付け')).toBeInTheDocument();
    expect(screen.getByText('(つける)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Good' }));

    expect(await screen.findByText('Recorded')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Good' })).not.toBeInTheDocument();

    await waitFor(async () => {
      expect(await db.reviews.count()).toBe(1);
    });
    const [review] = await db.reviews.toArray();
    expect(review?.source).toBe('natural_encounter');
    expect(review?.contextSentenceId).toBe('sent-1');
    expect(review?.rating).toBe('good');

    const studyItems = await db.studyItems
      .where('subjectId')
      .equals('vocab-tsukeru')
      .toArray();
    expect(studyItems).toHaveLength(1);
    expect(studyItems[0]?.subjectType).toBe('vocabularyItem');
    expect(studyItems[0]?.activityType).toBe('reading_retrieval');
  });
});
