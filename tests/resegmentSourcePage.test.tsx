import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { resetDbForTests } from '../src/db/database';
import { createBook, ensureStudyItem, getDb } from '../src/db/repository';
import { createId, sentenceIdFromNormalizedKey } from '../src/lib/ids';
import { normalizeSentenceKey } from '../src/lib/normalize';
import * as miningApi from '../src/lib/miningApi';
import { ResegmentSourcePage } from '../src/pages/ResegmentSourcePage';
import { withAppProviders } from '../src/test/providers';
import type { Sentence } from '../src/domain/types';

vi.mock('../src/lib/miningApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/miningApi')>()),
  resegmentSentences: vi.fn(),
}));

function shadowingSentence(japanese: string, index: number): Sentence {
  const normalizedKey = normalizeSentenceKey(japanese);
  return {
    id: sentenceIdFromNormalizedKey(normalizedKey),
    normalizedKey,
    japanese,
    readingOnly: '',
    inlineReading: '',
    translation: `T${index}`,
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [
      {
        cardId: `source-VID:sentence-${index}`,
        cardType: 'SHADOWING',
        contextNumber: 1,
        userNotes: 'Video position: 1.0–2.0 seconds',
        importBatchId: 'b',
      },
    ],
    conflicts: [],
    firstOccurrenceIndex: index,
    importBatchIds: ['b'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function seed() {
  const db = getDb();
  const book = await createBook({ title: 'After Work', sourceKey: 'shadowing:VID' });
  const a = shadowingSentence('さすがです。水希。たったの', 0);
  const b = shadowingSentence('1ヶ月だよ。変わんないじゃん。', 1);
  await db.sentences.bulkPut([a, b]);
  await db.bookSentences.bulkPut([
    { id: createId('bs'), bookId: book.id, sentenceId: a.id, position: 0, status: 'unstarted', addedAt: new Date().toISOString() },
    { id: createId('bs'), bookId: book.id, sentenceId: b.id, position: 1, status: 'unstarted', addedAt: new Date().toISOString() },
  ]);
  await ensureStudyItem('sentence', a.id, 'comprehension');
  return { book, a, b };
}

function renderPage(bookId: string) {
  return render(
    withAppProviders(
      <MemoryRouter initialEntries={[`/books/${bookId}/resegment`]}>
        <Routes>
          <Route path="books/:bookId/resegment" element={<ResegmentSourcePage />} />
          <Route path="books/:bookId" element={<div>book detail</div>} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe('ResegmentSourcePage', () => {
  beforeEach(() => {
    resetDbForTests(`reseg-page-${createId('db')}`);
    vi.mocked(miningApi.resegmentSentences).mockReset();
  });

  it('runs drama re-segmentation, shows the plan summary, and applies it', async () => {
    const { book, a, b } = await seed();
    const clean = ['さすがです。', '水希。', 'たったの1ヶ月だよ。', '変わんないじゃん。'];
    vi.mocked(miningApi.resegmentSentences).mockImplementation(async (sentences, options) => {
      // drama pass returns the clean split; annotate-only pass echoes input.
      const merged = options?.merge === false;
      const texts = merged ? sentences.map((s) => s.japanese) : clean;
      return texts.map((japanese, i) => ({
        japanese,
        startMs: 0,
        endMs: 0,
        reading: null,
        tokens: null,
        sourceIndexes: merged ? [i] : [0, 1],
      }));
    });

    const user = userEvent.setup();
    renderPage(book.id);

    await user.click(await screen.findByRole('button', { name: /punctuated transcript/i }));

    // One review row per clean sentence.
    await waitFor(() =>
      expect(screen.getByText(/4 sentences/)).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue('たったの1ヶ月だよ。')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(screen.getByText('book detail')).toBeInTheDocument());

    const db = getDb();
    expect(await db.sentences.get(a.id)).toBeUndefined();
    expect(await db.sentences.get(b.id)).toBeUndefined();
    const membership = await db.bookSentences.where('bookId').equals(book.id).sortBy('position');
    const fresh = (await db.sentences.bulkGet(membership.map((m) => m.sentenceId))).filter(Boolean);
    expect(fresh.map((s) => s!.japanese)).toEqual(clean);
    // The lone study item survived onto one of the new sentences.
    const studyItems = await db.studyItems.toArray();
    expect(studyItems).toHaveLength(1);
    expect(studyItems[0]!.subjectType).toBe('sentence');
    expect(membership.map((m) => m.sentenceId)).toContain(studyItems[0]!.subjectId);
  });

  it('lets the user remove an uninteresting row before applying', async () => {
    const { book } = await seed();
    vi.mocked(miningApi.resegmentSentences).mockImplementation(async (sentences) =>
      sentences.map((s, i) => ({
        japanese: s.japanese,
        startMs: 0,
        endMs: 0,
        reading: null,
        tokens: null,
        sourceIndexes: [i],
      })),
    );
    const user = userEvent.setup();
    renderPage(book.id);
    await user.click(await screen.findByRole('button', { name: /lyrics \/ manual/i }));
    await waitFor(() => expect(screen.getByText(/2 sentences/)).toBeInTheDocument());

    const firstRow = screen
      .getByDisplayValue('さすがです。水希。たったの')
      .closest('section')!;
    await user.click(within(firstRow).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.getByText(/1 sentences/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.getByText('book detail')).toBeInTheDocument());

    const db = getDb();
    const membership = await db.bookSentences.where('bookId').equals(book.id).sortBy('position');
    const fresh = (await db.sentences.bulkGet(membership.map((m) => m.sentenceId))).filter(Boolean);
    expect(fresh.map((s) => s!.japanese)).toEqual(['1ヶ月だよ。変わんないじゃん。']);
  });

  it('lets the user merge two rows before applying (lyrics mode)', async () => {
    const { book } = await seed();
    vi.mocked(miningApi.resegmentSentences).mockImplementation(async (sentences) =>
      sentences.map((s, i) => ({
        japanese: s.japanese,
        startMs: 0,
        endMs: 0,
        reading: null,
        tokens: null,
        sourceIndexes: [i],
      })),
    );

    const user = userEvent.setup();
    renderPage(book.id);
    await user.click(await screen.findByRole('button', { name: /lyrics \/ manual/i }));

    await waitFor(() => expect(screen.getByText(/2 sentences/)).toBeInTheDocument());
    const secondRow = screen.getByDisplayValue('1ヶ月だよ。変わんないじゃん。').closest('section')!;
    await user.click(within(secondRow).getByRole('button', { name: 'Merge up' }));

    await waitFor(() => expect(screen.getByText(/1 sentences/)).toBeInTheDocument());
  });
});
