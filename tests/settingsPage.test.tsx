import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { createBook, getDb } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { SettingsPage } from '../src/pages/SettingsPage';
import { withAppProviders } from '../src/test/providers';

function renderSettingsPage() {
  return render(
    withAppProviders(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    ),
  );
}

describe('SettingsPage new-cards-per-session control (Phase 7.10)', () => {
  beforeEach(async () => {
    resetDbForTests(`settings-page-${createId('db')}`);
    await ensureSettings();
  });

  it('shows the default limit and persists a change', async () => {
    renderSettingsPage();

    const input = await screen.findByLabelText('New cards per review session');
    expect(input).toHaveValue(20);

    fireEvent.change(input, { target: { value: '5' } });

    await waitFor(async () => {
      const settings = await getDb().settings.get('settings');
      expect(settings?.newCardsPerSessionLimit).toBe(5);
    });
  });

  it('shows the default graduation threshold and persists a change', async () => {
    renderSettingsPage();

    const input = await screen.findByLabelText(
      'Graduate after this many days between reviews',
    );
    expect(input).toHaveValue(180);

    fireEvent.change(input, { target: { value: '90' } });

    await waitFor(async () => {
      const settings = await getDb().settings.get('settings');
      expect(settings?.graduationMinScheduledDays).toBe(90);
    });
  });
});

describe('SettingsPage destructive actions use an inline two-step confirm', () => {
  beforeEach(async () => {
    resetDbForTests(`settings-page-confirm-${createId('db')}`);
    await ensureSettings();
  });

  it('does not wipe local data until the confirm is pressed a second time', async () => {
    await createBook({ title: 'Keep me' });
    const user = userEvent.setup();
    renderSettingsPage();

    await user.click(
      await screen.findByRole('button', { name: 'Remove local data from this device' }),
    );

    // Armed, not fired — the book is still there.
    expect(
      screen.getByText('Remove ALL local study data from this device? A backup downloads first.'),
    ).toBeInTheDocument();
    expect(await getDb().books.count()).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await getDb().books.count()).toBe(1);

    await user.click(
      screen.getByRole('button', { name: 'Remove local data from this device' }),
    );
    await user.click(screen.getByRole('button', { name: 'Remove local data' }));

    await waitFor(async () => {
      expect(await getDb().books.count()).toBe(0);
    });
  });
});
