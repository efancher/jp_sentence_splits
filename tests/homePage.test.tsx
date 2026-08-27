import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { addMinutesToTodaySession, getDb } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { HomePage } from '../src/pages/HomePage';
import { withAppProviders } from '../src/test/providers';

function renderHomePage() {
  return render(
    withAppProviders(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    ),
  );
}

describe('HomePage', () => {
  beforeEach(async () => {
    resetDbForTests(`home-page-${createId('db')}`);
    await ensureSettings();
  });

  it('shows the "Customize split" inputs without needing a click (2026-08-27 follow-up)', async () => {
    renderHomePage();
    expect(await screen.findByLabelText('New sentences (glossing)')).toBeInTheDocument();
  });

  it('clears today\'s session via an inline confirm, with no native dialog', async () => {
    await addMinutesToTodaySession(30);
    const user = userEvent.setup();
    renderHomePage();

    await screen.findByText(/min planned today/);
    await user.click(screen.getByRole('button', { name: "Clear today's session" }));

    expect(screen.getByText(/Clear today's plan and start over/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes, clear it' }));

    await waitFor(async () => {
      const sessions = await getDb().plannerSessions.toArray();
      expect(sessions).toHaveLength(0);
    });
    expect(await screen.findByText(/Nothing planned yet today/)).toBeInTheDocument();
  });

  it('cancelling the clear confirmation leaves the session untouched', async () => {
    await addMinutesToTodaySession(30);
    const user = userEvent.setup();
    renderHomePage();

    await screen.findByText(/min planned today/);
    await user.click(screen.getByRole('button', { name: "Clear today's session" }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText(/Clear today's plan and start over/)).not.toBeInTheDocument();
    const sessions = await getDb().plannerSessions.toArray();
    expect(sessions).toHaveLength(1);
  });
});
