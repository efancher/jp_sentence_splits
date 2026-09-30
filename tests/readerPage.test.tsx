import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb, readSettings } from '../src/db/repository';
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

  it('offers an optional whole-episode focus draft that never blocks reading', async () => {
    await seedBook();
    const db = getDb();
    const now = new Date().toISOString();
    await db.vocabularyItems.add({ id: 'v-1', expression: '図書館', reading: 'としょかん', meaning: 'library', createdAt: now, updatedAt: now });
    await db.sentenceVocabulary.bulkAdd(['sent-1', 'sent-2'].map((sentenceId) => ({
      id: `sv-${sentenceId}`, sentenceId, vocabularyItemId: 'v-1', createdAt: now, updatedAt: now,
    })));
    renderReaderPage('/books/book-1/read');

    await screen.findByText('本を読みます。');
    const summary = await screen.findByText('Suggested focus for this book');
    expect(summary.closest('details')).toHaveTextContent('図書館');
    expect(summary.closest('details')).toHaveTextContent('Appears in 2 sentences');
    expect(await db.studyItems.count()).toBe(0);
  });

  it('walks through a sentence with no vocabulary, analysis or gating, keeping audio adjust and quiet mode reachable', async () => {
    await seedBook();
    const user = userEvent.setup();
    renderReaderPage('/books/book-1/read');
    await screen.findByText('本を読みます。');
    await user.click(screen.getAllByRole('button', { name: 'Walk through' })[0]!);

    const panel = await screen.findByRole('region', { name: 'Sentence walkthrough' });
    expect(panel).toHaveTextContent('Automatic draft');
    expect(panel).toHaveTextContent('Step 1 of');
    expect(panel).toHaveTextContent('not assessed yet');
    // Adjust itself needs a real Blob size, which fake-indexeddb drops; the walkthrough mounts the same NativeAudioButton.
    expect(within(panel).getByRole('button', { name: /Play native sentence recording/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(panel).toHaveTextContent('Step 2 of');

    await user.click(screen.getByLabelText(/Can.t speak right now/));
    await waitFor(async () => expect((await readSettings()).quietMode).toBe(true));

    await user.click(screen.getByRole('button', { name: 'Back to reading' }));
    expect(screen.queryByRole('region', { name: 'Sentence walkthrough' })).not.toBeInTheDocument();
    expect(await getDb().studyItems.count()).toBe(0);
    expect(await getDb().reviews.count()).toBe(0);
  });

  it('says so when a walked-through sentence has no native audio', async () => {
    await seedBook();
    const user = userEvent.setup();
    renderReaderPage('/books/book-1/read');
    await screen.findByText('電気を消しました。');
    await user.click(screen.getAllByRole('button', { name: 'Walk through' })[1]!);
    expect(await screen.findByText(/No native audio for this sentence/)).toBeInTheDocument();
  });

  it('shows no focus panel when nothing recurs', async () => {
    await seedBook();
    renderReaderPage('/books/book-1/read');
    await screen.findByText('本を読みます。');
    expect(screen.queryByText(/Suggested focus/)).not.toBeInTheDocument();
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
