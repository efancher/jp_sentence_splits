import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { ReaderPage } from '../src/pages/ReaderPage';
import { withAppProviders } from '../src/test/providers';

async function seedBook() {
  const db = getDb();
  const now = new Date().toISOString();
  await db.books.add({
    id: 'book-1',
    title: 'Test Book',
    archived: false,
    chapters: [
      { id: 'ch-1', title: 'Chapter One', position: 0 },
      { id: 'ch-2', title: 'Chapter Two', position: 1 },
    ],
    updatedAt: now,
  });
  await db.sentences.bulkAdd([
    {
      id: 'sent-1',
      normalizedKey: 'sent-1',
      japanese: '本を読みます。',
      readingOnly: 'ほんをよみます。',
      inlineReading: '本[ほん]を読[よ]みます。',
      translation: 'I read a book.',
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
      japanese: '電気を消しました。',
      readingOnly: 'でんきをけしました。',
      inlineReading: '電気[でんき]を消[け]しました。',
      translation: 'I turned off the light.',
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
    {
      id: 'bs-1',
      bookId: 'book-1',
      sentenceId: 'sent-1',
      position: 0,
      status: 'unstarted',
      addedAt: now,
      chapterId: 'ch-1',
    },
    {
      id: 'bs-2',
      bookId: 'book-1',
      sentenceId: 'sent-2',
      position: 1,
      status: 'unstarted',
      addedAt: now,
      chapterId: 'ch-2',
    },
  ]);
  await db.sentenceAudio.add({
    id: 'audio-1',
    sentenceId: 'sent-1',
    sourceId: 'source-1',
    sourceSentenceId: 'source-sent-1',
    sourceTitle: 'Reference Video',
    mimeType: 'audio/mp4',
    durationMs: 1_200,
    startMs: 0,
    endMs: 1_200,
    blob: new Blob(['ref'], { type: 'audio/mp4' }),
    importedAt: now,
  });
}

function renderReaderPage(path: string) {
  return render(
    withAppProviders(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="books/:bookId/read" element={<ReaderPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe('ReaderPage (always-available chapter read-along)', () => {
  beforeEach(async () => {
    resetDbForTests(`reader-page-${createId('db')}`);
    await ensureSettings();
  });

  it('renders every sentence in the whole book when no chapter is given, with a Play control', async () => {
    await seedBook();
    renderReaderPage('/books/book-1/read');

    await screen.findByText('本を読みます。');
    expect(screen.getByText('電気を消しました。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '▶ Play' })).toBeInTheDocument();
  });

  it('scopes to a single chapter via the ?chapter= param', async () => {
    await seedBook();
    renderReaderPage('/books/book-1/read?chapter=ch-2');

    await screen.findByText('電気を消しました。');
    expect(screen.queryByText('本を読みます。')).not.toBeInTheDocument();
    // ch-2's sentence has no native audio — degrades to plain text, no play button, and a warning.
    expect(screen.getByText(/No native audio for this chapter yet\./)).toBeInTheDocument();
  });

  it('does not offer a play button for a sentence with no native audio', async () => {
    await seedBook();
    renderReaderPage('/books/book-1/read');

    await screen.findByText('本を読みます。');
    expect(screen.getAllByRole('button', { name: 'Play from here' })).toHaveLength(1);
  });

  it('switches to furigana/reading-only text via the display-mode toggle', async () => {
    await seedBook();
    const user = userEvent.setup();
    renderReaderPage('/books/book-1/read');

    await screen.findByText('本を読みます。');
    await user.selectOptions(screen.getByLabelText('Text'), 'reading');
    expect(screen.getByText('ほんをよみます。')).toBeInTheDocument();
    expect(screen.queryByText('本を読みます。')).not.toBeInTheDocument();
  });

  it('keeps translations hidden until revealed per sentence', async () => {
    await seedBook();
    const user = userEvent.setup();
    renderReaderPage('/books/book-1/read');

    await screen.findByText('本を読みます。');
    expect(screen.queryByText('I read a book.')).not.toBeInTheDocument();

    const [reveal] = screen.getAllByRole('button', { name: 'Show translation' });
    await user.click(reveal!);
    expect(screen.getByText('I read a book.')).toBeInTheDocument();
  });
});
