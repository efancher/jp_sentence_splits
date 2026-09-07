import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

async function seedEligibleSentence({
  japanese = 'りんごを食べる。',
  expression = '食べる',
  reading = 'たべる',
  surfaceForm = '食べる',
  pitchAccentPositions = [2] as number[] | undefined,
  withAudio = false,
} = {}) {
  const db = getDb();
  const now = new Date().toISOString();
  await db.sentences.add({
    id: 's1',
    normalizedKey: 's1',
    japanese,
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
    expression,
    reading,
    meaning: 'to eat',
    pitchAccentPositions,
    createdAt: now,
    updatedAt: now,
  });
  await db.sentenceVocabulary.add({
    id: 'link-1',
    sentenceId: 's1',
    vocabularyItemId: 'vocab-1',
    surfaceForm,
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
  if (withAudio) {
    await db.sentenceAudio.add({
      id: 's1-audio',
      sentenceId: 's1',
      sourceId: 'src',
      sourceSentenceId: 'src-s1',
      sourceTitle: 'ref',
      mimeType: 'audio/mp3',
      durationMs: 1000,
      startMs: 0,
      endMs: 1000,
      blob: new Blob(['x'], { type: 'audio/mp3' }),
      importedAt: now,
    });
  }
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

  it('shows the sentence marks and Record control straight away — no predict step', async () => {
    await seedEligibleSentence();
    renderPage();

    expect(
      await screen.findByLabelText('Sentence with pitch accent (H = high mora, L = low mora)'),
    ).toBeInTheDocument();
    expect(screen.getByText('りんごを')).toBeInTheDocument();
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument();
    // The old "predict the drop" beat is gone.
    expect(screen.queryByText(/Where does/)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Predict where this word's pitch falls"),
    ).not.toBeInTheDocument();
  });

  it('marks the grammatical particle attached to an accented word', async () => {
    await seedEligibleSentence({
      japanese: '犬が好き。',
      expression: '犬',
      reading: 'いぬ',
      surfaceForm: '犬',
    });
    renderPage();
    // 犬 (いぬ, odaka) + attached が on the sentence line.
    expect(await screen.findByText('犬が')).toBeInTheDocument();
  });

  it('single-word mode drills one proficient pitch-carrying word with its context', async () => {
    await seedEligibleSentence({ withAudio: true });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Single words' }));

    // Word alone gets its marks; the sentence is context (with audio — which
    // the sentence list would have excluded).
    expect(
      await screen.findByLabelText('Sentence with pitch accent (H = high mora, L = low mora)'),
    ).toBeInTheDocument();
    expect(screen.getByText(/たべる — to eat/)).toBeInTheDocument();
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument();
  });

  it('single-word mode includes the particle that follows the word', async () => {
    await seedEligibleSentence({
      japanese: '犬が好き。',
      expression: '犬',
      reading: 'いぬ',
      surfaceForm: '犬',
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Single words' }));

    // The drilled unit is 犬 + が, not bare 犬.
    expect(await screen.findByText('犬が')).toBeInTheDocument();
  });

  it('single-word mode explains what is needed when there are no eligible words', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Single words' }));
    expect(await screen.findByText(/No eligible words yet/)).toBeInTheDocument();
  });
});
