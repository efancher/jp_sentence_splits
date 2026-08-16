import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import {
  ensureStudyItem,
  ensureVocabularyItem,
  ensureVocabularyStudyItem,
  getDb,
  recordReview,
} from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { StudyItemDebugPage } from '../src/pages/StudyItemDebugPage';
import { withAppProviders } from '../src/test/providers';

function renderPage(studyItemId: string) {
  return render(
    withAppProviders(
      <MemoryRouter initialEntries={[`/study-items/${studyItemId}`]}>
        <Routes>
          <Route path="study-items/:studyItemId" element={<StudyItemDebugPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe('StudyItemDebugPage (Phase 7.10)', () => {
  beforeEach(async () => {
    resetDbForTests(`study-item-debug-${createId('db')}`);
    await ensureSettings();
  });

  it('shows "not found" for an unknown study item id', async () => {
    renderPage('missing-id');
    expect(await screen.findByText('Study item not found.')).toBeInTheDocument();
  });

  it('shows FSRS scheduling state and review history for a sentence subject', async () => {
    const studyItem = await ensureStudyItem('sentence', 'sent-1', 'comprehension');
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
    await recordReview({ studyItemId: studyItem.id, rating: 'good' });

    renderPage(studyItem.id);

    expect(await screen.findByText('本を読みます。')).toBeInTheDocument();
    expect(screen.getByText('comprehension')).toBeInTheDocument();
    expect(screen.getByText('good')).toBeInTheDocument();
    expect(screen.getByText('Source: scheduled_review')).toBeInTheDocument();
    expect(screen.getByText('Review history (1)')).toBeInTheDocument();
  });

  it('shows maturity level for a vocabularyItem subject', async () => {
    const vocabItem = await ensureVocabularyItem('表す', 'あらわす');
    const studyItem = await ensureVocabularyStudyItem(vocabItem.id, 'reading_retrieval');

    renderPage(studyItem.id);

    expect(await screen.findByText('表す')).toBeInTheDocument();
    expect(screen.getByText('あらわす')).toBeInTheDocument();
    expect(screen.getByText('Fragile')).toBeInTheDocument();
    expect(screen.getByText('Review history (0)')).toBeInTheDocument();
    expect(screen.getByText('No reviews recorded yet.')).toBeInTheDocument();
  });

  it('shows typed responseRaw/expectedAnswer and the context sentence for a natural-encounter review', async () => {
    const vocabItem = await ensureVocabularyItem('付ける', 'つける');
    const studyItem = await ensureVocabularyStudyItem(vocabItem.id, 'reading_retrieval');
    await getDb().sentences.add({
      id: 'sent-context',
      normalizedKey: 'sent-context',
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await recordReview({
      studyItemId: studyItem.id,
      rating: 'easy',
      source: 'natural_encounter',
      contextSentenceId: 'sent-context',
      responseRaw: 'つける',
      expectedAnswer: 'つける',
    });

    renderPage(studyItem.id);

    expect(await screen.findByText('Source: natural_encounter')).toBeInTheDocument();
    expect(screen.getByText(/Typed: つける/)).toBeInTheDocument();
    expect(screen.getByText(/From: 電気を付けました。/)).toBeInTheDocument();
  });
});
