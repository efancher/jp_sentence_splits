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
    expect(await screen.findByLabelText('New sentences, fresh tries & vocabulary')).toBeInTheDocument();
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

  it('offers Replan fresh and Clear even when no session is displayed', async () => {
    renderHomePage();
    await screen.findByText(/Nothing planned yet today/);
    expect(screen.getByRole('button', { name: /Replan fresh/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Clear today's session" })).toBeInTheDocument();
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

  it('replans today\'s session fresh: a new session with the same minutes and no stored snapshots', async () => {
    const first = await addMinutesToTodaySession(30);
    await getDb().plannerSnapshots.put({ id: 'studyItems#0', table: 'studyItems', chunk: 0, rows: [] });
    const user = userEvent.setup();
    renderHomePage();

    await screen.findByText(/min planned today/);
    await user.click(screen.getByRole('button', { name: 'Replan fresh (30 min)' }));

    await waitFor(async () => {
      const sessions = await getDb().plannerSessions.toArray();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.id).not.toBe(first.id);
      expect(sessions[0]!.targetMinutes).toBe(30);
    });
    expect(await getDb().plannerSnapshots.get('studyItems#0')).toBeUndefined();
  });

  it('names an earlier day\'s open session, and starting today\'s ends it', async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    const old = await addMinutesToTodaySession(30, yesterday);
    const user = userEvent.setup();
    renderHomePage();

    expect(await screen.findByText(/is still open/)).toHaveTextContent(`The session from ${old.date} is still open`);
    await user.click(screen.getByRole('button', { name: /^Start/ }));

    await waitFor(async () => {
      expect((await getDb().plannerSessions.get(old.id))?.status).toBe('ended_early');
    });
    expect(screen.queryByText(/is still open/)).not.toBeInTheDocument();
  });
});
