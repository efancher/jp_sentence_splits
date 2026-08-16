import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb } from '../src/db/repository';
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
