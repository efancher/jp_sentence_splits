import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import {
  createBook,
  ensureGrammarPattern,
  ensureGrammarRelationship,
  ensureGrammarStudyItem,
  ensureSentenceGrammar,
  getDb,
} from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { GrammarPatternDetailPage } from '../src/pages/GrammarPatternDetailPage';
import { withAppProviders } from '../src/test/providers';

function renderPage(patternId: string) {
  return render(
    withAppProviders(
      <MemoryRouter initialEntries={[`/grammar/${patternId}`]}>
        <Routes>
          <Route path="/grammar" element={<div>grammar list</div>} />
          <Route path="/grammar/:patternId" element={<GrammarPatternDetailPage />} />
          <Route
            path="/books/:bookId/analyze/:sentenceId"
            element={<div>analyze page</div>}
          />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

async function stubSentence(id: string, japanese: string) {
  const now = new Date().toISOString();
  await getDb().sentences.add({
    id,
    normalizedKey: id,
    japanese,
    readingOnly: '',
    inlineReading: '',
    translation: '',
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: now,
    updatedAt: now,
  });
}

describe('GrammarPatternDetailPage', () => {
  beforeEach(async () => {
    resetDbForTests(`grammar-detail-page-${createId('db')}`);
    await ensureSettings();
  });

  it('shows an unknown-pattern message when no pattern row exists', async () => {
    renderPage('missing-id');
    expect(await screen.findByText(/unknown grammar pattern/i)).toBeInTheDocument();
  });

  it('shows the pattern name, aliases, and Tracked badge', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない', {
      aliases: ['わけない'],
    });
    await ensureGrammarStudyItem(pattern.id, 'grammar_comprehension');

    renderPage(pattern.id);

    expect(await screen.findByText('〜わけがない')).toBeInTheDocument();
    expect(screen.getByText(/わけない/)).toBeInTheDocument();
    expect(screen.getByText('Tracked')).toBeInTheDocument();
  });

  it('editing and saving the fields persists to the pattern', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    const user = userEvent.setup();
    renderPage(pattern.id);

    const meaningInput = await screen.findByLabelText(
      'Short meaning / communicative function',
    );
    await user.type(meaningInput, "there's no way...");
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Saved');
    const updated = await getDb().grammarPatterns.get(pattern.id);
    expect(updated?.shortMeaning).toBe("there's no way...");
  });

  it('shows an empty encounters state with no linked sentences', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    renderPage(pattern.id);

    expect(await screen.findByText('Your encounters (0)')).toBeInTheDocument();
    expect(
      screen.getByText(/no sentences tagged with this pattern yet/i),
    ).toBeInTheDocument();
  });

  it('lists encounters with sentence text, book, confirmation, and a link into Analyze', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    await stubSentence('sent-1', 'そんなこと言うわけないでしょ。');
    const book = await createBook({ title: 'My Book' });
    await getDb().bookSentences.add({
      id: 'bs-1',
      bookId: book.id,
      sentenceId: 'sent-1',
      position: 0,
      status: 'unstarted',
      addedAt: new Date().toISOString(),
    });
    await ensureSentenceGrammar('sent-1', pattern.id, { confirmedByLearner: true });

    renderPage(pattern.id);

    expect(await screen.findByText('Your encounters (1)')).toBeInTheDocument();
    expect(screen.getByText('そんなこと言うわけないでしょ。')).toBeInTheDocument();
    expect(screen.getByText('My Book')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'そんなこと言うわけないでしょ。' });
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining(`/books/${book.id}/analyze/sent-1`),
    );
  });

  it('shows Recognized once a tracked pattern is FSRS-proficient', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    const item = await ensureGrammarStudyItem(pattern.id, 'grammar_comprehension');
    await getDb().studyItems.update(item.id, {
      fsrsState: { ...item.fsrsState, state: 'review' },
    });

    renderPage(pattern.id);

    await screen.findByText('〜わけがない');
    expect(screen.getByText('Recognized')).toBeInTheDocument();
  });

  it('shows Distinguished once tracked, comprehension-proficient, and contrast-proficient', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    const comprehensionItem = await ensureGrammarStudyItem(pattern.id, 'grammar_comprehension');
    await getDb().studyItems.update(comprehensionItem.id, {
      fsrsState: { ...comprehensionItem.fsrsState, state: 'review' },
    });
    const contrastItem = await ensureGrammarStudyItem(pattern.id, 'grammar_contrast');
    await getDb().studyItems.update(contrastItem.id, {
      fsrsState: { ...contrastItem.fsrsState, state: 'review' },
    });

    renderPage(pattern.id);

    await screen.findByText('〜わけがない');
    expect(screen.getByText('Distinguished')).toBeInTheDocument();
  });

  it('shows an empty related-patterns state with no relationships', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    renderPage(pattern.id);

    expect(await screen.findByText('Related patterns')).toBeInTheDocument();
    expect(screen.getByText(/no related patterns linked yet/i)).toBeInTheDocument();
  });

  it('lists an existing relationship with its type and links to the other pattern', async () => {
    const wakega = await ensureGrammarPattern('〜わけがない');
    const hazuga = await ensureGrammarPattern('〜はずがない', {
      shortMeaning: 'should be...',
    });
    await ensureGrammarRelationship(wakega.id, hazuga.id, 'commonly_confused');

    renderPage(wakega.id);

    await screen.findByText('Related patterns');
    expect(screen.getByText('〜はずがない')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /はずがない/ });
    expect(link).toHaveTextContent('Commonly confused with');
    expect(link).toHaveAttribute('href', expect.stringContaining(`/grammar/${hazuga.id}`));
  });

  it('creates a new relationship via the related-patterns picker', async () => {
    const wakega = await ensureGrammarPattern('〜わけがない');
    const hazuga = await ensureGrammarPattern('〜はずがない');
    const user = userEvent.setup();

    renderPage(wakega.id);
    await screen.findByText('Related patterns');

    await user.selectOptions(screen.getByLabelText('Relationship type'), 'commonly_confused');
    await user.selectOptions(screen.getByLabelText('Pattern to link'), hazuga.id);
    await user.click(screen.getByRole('button', { name: 'Link' }));

    expect(await screen.findByText('〜はずがない')).toBeInTheDocument();
    expect(await getDb().grammarRelationships.count()).toBe(1);
  });

  it('shows plain (unlinked) sentence text for an encounter with no book membership', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    await stubSentence('sent-1', '忘れるわけがない。');
    await ensureSentenceGrammar('sent-1', pattern.id, {});

    renderPage(pattern.id);

    expect(await screen.findByText('忘れるわけがない。')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: '忘れるわけがない。' }),
    ).not.toBeInTheDocument();
  });
});
