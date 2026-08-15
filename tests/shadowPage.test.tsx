import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { ShadowPage } from '../src/pages/ShadowPage';
import { withAppProviders } from '../src/test/providers';

async function seed() {
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
  await db.attempts.bulkAdd([
    {
      id: 'attempt-older',
      sentenceId: 'sent-1',
      mimeType: 'audio/webm',
      durationMs: 2_000,
      blob: new Blob(['older'], { type: 'audio/webm' }),
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'attempt-newer',
      sentenceId: 'sent-1',
      mimeType: 'audio/webm',
      durationMs: 1_500,
      blob: new Blob(['newer'], { type: 'audio/webm' }),
      createdAt: '2026-01-02T00:00:00.000Z',
      manualRating: 'better',
    },
  ]);
}

function renderShadowPage() {
  return render(
    withAppProviders(
      <MemoryRouter initialEntries={['/books/book-1/shadow/sent-1']}>
        <Routes>
          <Route path="books/:bookId/shadow/:sentenceId" element={<ShadowPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe('ShadowPage', () => {
  beforeEach(async () => {
    resetDbForTests(`shadow-page-${createId('db')}`);
    await ensureSettings();
    await seed();
    // Blob-round-trip-through-Dexie compat (fake-indexeddb/jsdom Blob
    // mismatch) is handled globally now — see src/test/setup.ts.
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the reference clip, record control, and past attempts', async () => {
    renderShadowPage();

    expect(await screen.findByText('本を読みます。')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /Play native sentence recording from Reference Video/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument();

    const attemptRows = screen.getAllByRole('listitem');
    expect(attemptRows).toHaveLength(2);
    // Newest first.
    expect(within(attemptRows[0]!).getByText(/1\.5s/)).toBeInTheDocument();
    expect(within(attemptRows[0]!).getByText(/better/)).toBeInTheDocument();
    expect(within(attemptRows[1]!).getByText(/2\.0s/)).toBeInTheDocument();

    const betterButtons = screen.getAllByRole('button', { name: 'Better' });
    expect(betterButtons[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('deletes an attempt after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderShadowPage();

    expect(await screen.findAllByRole('listitem')).toHaveLength(2);
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    await user.click(deleteButtons[0]!);

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
    });
  });

  it('does not delete when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderShadowPage();

    expect(await screen.findAllByRole('listitem')).toHaveLength(2);
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    await user.click(deleteButtons[0]!);

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});
