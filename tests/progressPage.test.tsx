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
});
