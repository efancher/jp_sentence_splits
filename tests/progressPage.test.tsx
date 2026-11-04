import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { ProgressPage } from '../src/pages/ProgressPage';
import { withAppProviders } from '../src/test/providers';

function renderProgressPage() {
  return render(
    withAppProviders(
      <MemoryRouter>
        <ProgressPage />
      </MemoryRouter>,
    ),
  );
}

const FSRS_REVIEW = {
  due: '2026-10-01T00:00:00.000Z',
  stability: 10,
  difficulty: 5,
  elapsedDays: 0,
  scheduledDays: 5,
  learningSteps: 0,
  reps: 3,
  lapses: 0,
  state: 'review' as const,
};

describe('ProgressPage', () => {
  beforeEach(async () => {
    resetDbForTests(`progress-page-${createId('db')}`);
    await ensureSettings();
  });

  it('prompts for data when there is no history', async () => {
    renderProgressPage();
    expect(await screen.findByText(/Nothing to report yet/)).toBeInTheDocument();
  });

  it('summarises tracked vocabulary and recall success from logged evidence', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.studyItems.add({
      id: 'si-1',
      subjectType: 'vocabularyItem',
      subjectId: 'vocab-1',
      activityType: 'reading_retrieval',
      fsrsState: FSRS_REVIEW,
      createdAt: now,
      updatedAt: now,
    });
    await db.reviews.bulkAdd([
      {
        id: 'r-1',
        studyItemId: 'si-1',
        timestamp: now,
        rating: 'good',
        source: 'scheduled_review',
      },
      {
        id: 'r-2',
        studyItemId: 'si-1',
        timestamp: now,
        rating: 'again',
        source: 'scheduled_review',
      },
    ]);

    renderProgressPage();

    expect(await screen.findByText('Tracked words')).toBeInTheDocument();
    expect(screen.getByText('Recall success (all time)')).toBeInTheDocument();
    // Both the 30-day and all-time rate are 1 pass of 2 scheduled reviews.
    expect(screen.getAllByText('50%').length).toBeGreaterThanOrEqual(1);
  });

  it('breaks down classified misses in the "What to work on" panel', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.studyItems.add({
      id: 'si-r',
      subjectType: 'vocabularyItem',
      subjectId: 'vocab-r',
      activityType: 'reading_production',
      fsrsState: FSRS_REVIEW,
      createdAt: now,
      updatedAt: now,
    });
    await db.reviews.bulkAdd([
      {
        id: 'r-a',
        studyItemId: 'si-r',
        timestamp: now,
        rating: 'again',
        source: 'scheduled_review',
        errorClassification: 'incorrect_reading',
      },
      {
        id: 'r-b',
        studyItemId: 'si-r',
        timestamp: now,
        rating: 'again',
        source: 'scheduled_review',
        errorClassification: 'incorrect_reading',
      },
    ]);

    renderProgressPage();

    expect(await screen.findByText('What to work on')).toBeInTheDocument();
    expect(await screen.findByText('Wrong reading')).toBeInTheDocument();
    expect(screen.getByText('Drill readings →')).toBeInTheDocument();
  });

  it('lists a recurring unconfirmed word in the "Blind spots" panel', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.books.add({
      id: 'book-1',
      title: 'Worked book',
      chapters: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    const sentence = (id: string) =>
      ({
        id,
        japanese: '面倒だ',
        readingOnly: 'めんどうだ',
        inlineReading: '面倒[めんどう]だ',
        translation: 'What a pain',
        targetVocabulary: [],
        vocabularySuggestions: [
          {
            id: `${id}-s`,
            surface: '面倒',
            start: 0,
            end: 2,
            expression: '面倒',
            reading: 'めんどう',
            pos: 'noun',
            source: 'morphology',
            selectedByDefault: true,
          },
        ],
        conflicts: [],
        sourceReferences: [],
        createdAt: now,
        updatedAt: now,
      }) as never;
    await db.sentences.bulkAdd([sentence('s1'), sentence('s2')]);
    await db.bookSentences.bulkAdd([
      {
        id: 'bs1',
        bookId: 'book-1',
        sentenceId: 's1',
        position: 0,
        status: 'complete',
        createdAt: now,
        updatedAt: now,
      } as never,
      {
        id: 'bs2',
        bookId: 'book-1',
        sentenceId: 's2',
        position: 1,
        status: 'unstarted',
        createdAt: now,
        updatedAt: now,
      } as never,
    ]);

    renderProgressPage();

    expect(await screen.findByText('Blind spots')).toBeInTheDocument();
    expect(await screen.findByText(/面倒/)).toBeInTheDocument();
    expect(screen.getByText('Confirm →')).toBeInTheDocument();
  });
  it('shows what followed a reader follow-up offer, with random draws separated from rule picks', async () => {
    const db = getDb();
    const at = Date.now() - 2 * 86_400_000;
    const base = { bookId: 'book-1', sentenceId: 'sent-1' };
    await db.sentenceLearningEvents.bulkAdd([
      { id: 'e1', visitId: 'v1', action: 'follow_up_offer', timestamp: new Date(at).toISOString(), target: { kind: 'expression', key: 'followup:tiles:random', label: 'listening' }, ...base },
      { id: 'e2', visitId: 'v1', action: 'target_practice', timestamp: new Date(at + 60_000).toISOString(), outcome: 'got_it', target: { kind: 'expression', key: 'eartiles:sent-1', label: 'Ear tiles' }, ...base },
      { id: 'e3', visitId: 'v2', action: 'gist_check', timestamp: new Date(at + 86_400_000).toISOString(), outcome: 'got_it', ...base },
    ] as never);

    renderProgressPage();

    expect(await screen.findByText('After a follow-up offer')).toBeInTheDocument();
    expect(await screen.findByText('Ear tiles (listening) — random draw')).toBeInTheDocument();
    expect(screen.getByText(/1 opened · next Read check: 1\/1 got it/)).toBeInTheDocument();
  });
});
