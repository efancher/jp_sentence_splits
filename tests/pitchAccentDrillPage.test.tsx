import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { PitchAccentDrillPage } from '../src/pages/PitchAccentDrillPage';
import { withAppProviders } from '../src/test/providers';

vi.mock('../src/lib/analysisApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/analysisApi')>()),
  alignAudio: vi.fn(),
  transcribeAudio: vi.fn(),
}));

const PROFICIENT_FSRS = {
  due: '2026-10-01T00:00:00.000Z',
  stability: 10,
  difficulty: 5,
  elapsedDays: 0,
  scheduledDays: 6,
  learningSteps: 0,
  reps: 3,
  lapses: 0,
  state: 'review' as const,
};

async function seedEligibleSentence() {
  const db = getDb();
  const now = new Date().toISOString();
  await db.sentences.add({
    id: 's1',
    normalizedKey: 's1',
    japanese: 'りんごを食べる。',
    readingOnly: '',
    inlineReading: '',
    translation: 'I eat an apple.',
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: now,
    updatedAt: now,
  });
  await db.analyses.add({
    sentenceId: 's1',
    chunks: [],
    notes: '',
    status: 'empty',
    formatVersion: 2,
    vocabularyReviewStatus: 'confirmed',
    vocabularySelections: [],
    createdAt: now,
    updatedAt: now,
  });
  await db.vocabularyItems.add({
    id: 'vocab-1',
    expression: '食べる',
    reading: 'たべる',
    meaning: 'to eat',
    pitchAccentPositions: [2],
    createdAt: now,
    updatedAt: now,
  });
  await db.sentenceVocabulary.add({
    id: 'link-1',
    sentenceId: 's1',
    vocabularyItemId: 'vocab-1',
    surfaceForm: '食べる',
    createdAt: now,
    updatedAt: now,
  });
  await db.studyItems.add({
    id: 'si-1',
    subjectType: 'vocabularyItem',
    subjectId: 'vocab-1',
    activityType: 'reading_retrieval',
    fsrsState: PROFICIENT_FSRS,
    createdAt: now,
    updatedAt: now,
  });
}

function renderPage() {
  return render(
    withAppProviders(
      <MemoryRouter>
        <PitchAccentDrillPage />
      </MemoryRouter>,
    ),
  );
}

describe('PitchAccentDrillPage', () => {
  beforeEach(async () => {
    resetDbForTests(`pa-drill-page-${createId('db')}`);
    await ensureSettings();
  });

  it('explains what is needed when there are no eligible sentences', async () => {
    renderPage();
    expect(await screen.findByText(/No eligible sentences yet/)).toBeInTheDocument();
  });

  it('shows an eligible sentence with its target contour and a Record control', async () => {
    await seedEligibleSentence();
    renderPage();

    expect(await screen.findByText('りんごを食べる。')).toBeInTheDocument();
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Pitch accent (H = high mora, L = low mora)'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument();
  });
});
