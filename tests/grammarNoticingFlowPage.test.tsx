import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  confirmSentenceVocabulary,
  createBook,
  getDb,
  setBookSentenceStatus,
} from '../src/db/repository';
import type { Sentence } from '../src/domain/types';
import { createId } from '../src/lib/ids';
import { GrammarNoticingFlowPage } from '../src/pages/GrammarNoticingFlowPage';
import { withAppProviders } from '../src/test/providers';

function makeSentence(overrides: Partial<Sentence> = {}): Sentence {
  const timestamp = new Date().toISOString();
  const id = overrides.id ?? createId('sent');
  return {
    id,
    normalizedKey: id,
    japanese: '猫が寝ています。',
    readingOnly: '',
    inlineReading: '',
    translation: 'The cat is sleeping.',
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

/** A worked-through, vocab-confirmed sentence with no vocabulary to gate on — the minimal fixture findGrammarNoticingCandidates picks up. */
async function seedEligibleSentence(id: string, japanese: string) {
  const db = getDb();
  await db.sentences.add(makeSentence({ id, japanese }));
  const book = await createBook({ title: `Book for ${id}` });
  await addSentencesToBook(book.id, [id]);
  await setBookSentenceStatus(book.id, id, 'complete');
  await confirmSentenceVocabulary(id, []);
}

function renderPage(initialEntry = '/notice-grammar') {
  return render(
    withAppProviders(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/notice-grammar" element={<GrammarNoticingFlowPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe('GrammarNoticingFlowPage', () => {
  beforeEach(async () => {
    resetDbForTests(`grammar-noticing-flow-${createId('db')}`);
    await ensureSettings();
  });

  it('standalone mode (no ?ids=) self-populates from findGrammarNoticingCandidates', async () => {
    await seedEligibleSentence('sent-1', '今日は天気がいいです。');

    renderPage('/notice-grammar');

    expect(await screen.findByText('今日は天気がいいです。')).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  it('standalone mode shows a specific empty state, not the generic ?ids= one, when nothing is eligible', async () => {
    renderPage('/notice-grammar');

    expect(
      await screen.findByText(/nothing eligible right now/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('No sentences to review.')).not.toBeInTheDocument();
  });

  it('?ids= mode still walks the exact given sentences without querying candidates', async () => {
    const db = getDb();
    await db.sentences.add(makeSentence({ id: 'sent-explicit', japanese: '明日は雨でしょう。' }));
    // Deliberately not marked complete/confirmed — an explicit ?ids= deep
    // link (from a session step) should show it regardless.
    renderPage('/notice-grammar?ids=sent-explicit');

    expect(await screen.findByText('明日は雨でしょう。')).toBeInTheDocument();
  });
});
