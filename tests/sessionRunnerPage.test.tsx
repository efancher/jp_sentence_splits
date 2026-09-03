import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import {
  addMinutesToTodaySession,
  ensureStudyItem,
  endPlannerSessionEarly,
  getDb,
  recordReview,
} from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { SessionRunnerPage } from '../src/pages/SessionRunnerPage';
import { withAppProviders } from '../src/test/providers';

function renderRunner(sessionId: string) {
  return render(
    withAppProviders(
      <MemoryRouter initialEntries={[`/session/${sessionId}`]}>
        <Routes>
          <Route path="/session/:sessionId" element={<SessionRunnerPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe('SessionRunnerPage recap', () => {
  beforeEach(async () => {
    resetDbForTests(`session-runner-${createId('db')}`);
    await ensureSettings();
  });

  it('shows the post-session recap once the session is settled', async () => {
    const session = await addMinutesToTodaySession(20);
    const studyItem = await ensureStudyItem('vocabularyItem', 'vocab-1', 'reading_retrieval');
    await recordReview({ studyItemId: studyItem.id, rating: 'good' });
    await endPlannerSessionEarly(session.id);

    renderRunner(session.id);

    expect(await screen.findByText('Today you')).toBeInTheDocument();
    expect(screen.getByText(/graded 1 review/)).toBeInTheDocument();
    expect(screen.getByText(/started 1 new word/)).toBeInTheDocument();
  });

  it('shows no recap while the session is still in progress', async () => {
    const session = await addMinutesToTodaySession(20);
    await getDb().plannerSessions.get(session.id); // sanity

    renderRunner(session.id);

    await screen.findByText(/Today's session/);
    expect(screen.queryByText('Today you')).not.toBeInTheDocument();
  });
});
