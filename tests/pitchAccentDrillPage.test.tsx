import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb, updateSettings } from '../src/db/repository';
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

  it('opens on the predict-the-drop step before revealing the answer', async () => {
    await seedEligibleSentence();
    renderPage();

    expect(
      await screen.findByLabelText("Predict where this word's pitch falls"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Where does/)).toBeInTheDocument();
    // The dictionary marks / Record control are gated behind the prediction.
    expect(
      screen.queryByLabelText('Sentence with pitch accent (H = high mora, L = low mora)'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument();
    // One choice per mora plus "no fall": たべる → 0..3.
    expect(screen.getByRole('button', { name: /Stays high \(no fall\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Falls after mora 3/ })).toBeInTheDocument();
  });

  it('reveals the sentence marks and Record control after a prediction', async () => {
    await seedEligibleSentence();
    renderPage();

    await userEvent.click(
      await screen.findByRole('button', { name: /Falls after mora 2/ }),
    );

    expect(await screen.findByText('りんごを')).toBeInTheDocument();
    expect(screen.getAllByText('食べる').length).toBeGreaterThan(0);
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Sentence with pitch accent (H = high mora, L = low mora)'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument();
    // 食べる is position 2 over 3 morae → nakadaka, drop after mora 2: a hit.
    expect(screen.getByLabelText('Your pitch-fall prediction')).toHaveTextContent(/✓/);
  });

  it('shows the dictionary contour when the prediction misses', async () => {
    await seedEligibleSentence();
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /Stays high \(no fall\)/ }));

    const result = await screen.findByLabelText('Your pitch-fall prediction');
    expect(result).toHaveTextContent(/✗/);
    expect(result).toHaveTextContent(/nakadaka/);
    // Still lets you record your attempt.
    expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument();
  });

  it('quiet mode: runs perception-only — no Skip button, no Record after predicting', async () => {
    await seedEligibleSentence();
    await updateSettings({ quietMode: true });
    renderPage();

    // The predict step still runs (it is silent), but without the skip-to-speaking escape.
    expect(
      await screen.findByLabelText("Predict where this word's pitch falls"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Skip — just practise saying it' }),
    ).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: /Falls after mora 2/ }));

    expect(await screen.findByText(/perception-only drill/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument();
    // The dictionary marks + prediction result still show.
    expect(screen.getByLabelText('Your pitch-fall prediction')).toBeInTheDocument();
  });

  it('skips straight to recording when the predict step is skipped', async () => {
    await seedEligibleSentence();
    renderPage();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Skip — just practise saying it' }),
    );

    expect(await screen.findByRole('button', { name: 'Record' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Your pitch-fall prediction')).not.toBeInTheDocument();
  });
});
