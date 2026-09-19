import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { logGameRound } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { withAppProviders } from '../src/test/providers';

// Real game pools need books + native audio; the panel only needs eligibility.
vi.mock('../src/games/registry', () => {
  const game = (id: string, title: string, eligible: number) => ({
    id,
    title,
    roundSize: 3,
    loadPools: async () => ({ eligible, bySignal: { weak: eligible, strong: eligible, stale: eligible } }),
  });
  return {
    GAMES: [
      game('odd-ear-out', 'Odd Ear Out', 5),
      game('verb-lego', 'Verb Lego', 5),
      game('word-detective', 'Word Detective', 0),
    ],
  };
});

import { DailyPracticePanel } from '../src/components/DailyPracticePanel';

function renderPanel() {
  return render(
    withAppProviders(
      <MemoryRouter>
        <DailyPracticePanel />
      </MemoryRouter>,
    ),
  );
}

describe('DailyPracticePanel', () => {
  beforeEach(async () => {
    resetDbForTests(`daily-practice-${createId('db')}`);
    await ensureSettings();
  });

  it('recommends Odd Ear Out and a playable rotating game, with progress from the round log', async () => {
    await logGameRound({ gameId: 'odd-ear-out', signal: 'weak', poolSize: 5, items: [] });
    renderPanel();

    expect(await screen.findByText('Daily practice')).toBeInTheDocument();
    // Odd Ear Out already played today -> complete.
    expect(await screen.findByText(/✓ Odd Ear Out — one round/)).toBeInTheDocument();
    expect(screen.getByText('1/1 round')).toBeInTheDocument();
    // The rotating slot never lands on the unplayable game.
    await waitFor(() => {
      expect(screen.queryByText(/Word Detective/)).not.toBeInTheDocument();
    });
    expect(await screen.findByText(/Verb Lego — one round/)).toBeInTheDocument();
    expect(screen.getByText('1/2 done today')).toBeInTheDocument();
  });
});
