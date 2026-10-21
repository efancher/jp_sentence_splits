import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { resetDbForTests } from '../src/db/database';
import { ensureStudyItem, ensureVocabularyItem, ensureVocabularyStudyItem, getDb } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { StudyItemsListPage } from '../src/pages/StudyItemsListPage';
import { withAppProviders } from '../src/test/providers';

function renderPage() {
  return render(
    withAppProviders(
      <MemoryRouter initialEntries={['/study-items']}>
        <Routes>
          <Route path="study-items" element={<StudyItemsListPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe('StudyItemsListPage', () => {
  beforeEach(() => {
    resetDbForTests(`study-items-list-${createId('db')}`);
  });

  it('shows an empty state when there are no study items yet', async () => {
    renderPage();
    expect(await screen.findByText('No study items yet.')).toBeInTheDocument();
  });

  it('lists a sentence subject by its Japanese text, and a vocabulary subject by expression/reading', async () => {
    await getDb().sentences.add({
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await ensureStudyItem('sentence', 'sent-1', 'comprehension');
    const vocabItem = await ensureVocabularyItem('表す', 'あらわす');
    await ensureVocabularyStudyItem(vocabItem.id, 'reading_retrieval');

    renderPage();

    expect(await screen.findByText('本を読みます。')).toBeInTheDocument();
    // Each type also appears once in the "Due now by card type" table.
    expect(screen.getAllByText('comprehension')).toHaveLength(2);
    expect(screen.getByText('表す (あらわす)')).toBeInTheDocument();
    expect(screen.getAllByText('reading_retrieval')).toHaveLength(2);
  });

  it('summarises due and total counts per card type', async () => {
    await ensureStudyItem('sentence', 'sent-a', 'comprehension');
    await ensureStudyItem('sentence', 'sent-b', 'comprehension');
    const later = await ensureStudyItem('sentence', 'sent-c', 'comprehension');
    await getDb().studyItems.update(later.id, {
      fsrsState: { ...later.fsrsState, due: new Date(Date.now() + 86_400_000).toISOString() },
    });

    renderPage();

    expect(await screen.findByText('Due now by card type')).toBeInTheDocument();
    const row = screen.getAllByText('comprehension')[0].closest('tr')!;
    expect(row).toHaveTextContent(/comprehension\s*2\s*3/);
  });

  it('links each row to its study-item debug page', async () => {
    const studyItem = await ensureStudyItem('sentence', 'sent-2', 'comprehension');
    await getDb().sentences.add({
      id: 'sent-2',
      normalizedKey: 'sent-2',
      japanese: '猫が好きです。',
      readingOnly: '',
      inlineReading: '',
      translation: 'I like cats.',
      targetVocabulary: [],
      vocabularySuggestions: [],
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 0,
      importBatchIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    renderPage();

    const link = await screen.findByRole('link', { name: /猫が好きです。/ });
    expect(link).toHaveAttribute('href', `/study-items/${studyItem.id}`);
  });
});
