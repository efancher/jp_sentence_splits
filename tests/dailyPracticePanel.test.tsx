import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const drill = vi.hoisted(() => ({ words: [] as unknown[], loads: 0 }));
vi.mock('../src/db/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/db/repository')>();
  // Real drill words need pitch-carrying vocabulary with native audio; the panel only needs the count.
  return { ...actual, getPitchAccentDrillWords: async () => {
      drill.loads += 1;
      return drill.words;
    }, getPitchAccentFocusWords: async () => [] };
});

import { DailyPracticePanel } from '../src/components/DailyPracticePanel';
import { ensureSettings, resetDbForTests } from '../src/db/database';
import { logPitchDrillAttempt, updateSettings } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { withAppProviders } from '../src/test/providers';

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
    drill.words = [{}];
    drill.loads = 0;
  });

  it("shows the pitch drill with today's takes", async () => {
    await logPitchDrillAttempt({
      mode: 'word',
      surfaceForm: '橋',
      reading: 'はし',
      contextSentenceId: 's1',
      measured: true,
      mismatch: false,
      focusTriggered: false,
    });
    renderPanel();
    expect(await screen.findByText(/Pitch drill — say 5 words/)).toBeInTheDocument();
    expect(screen.getByText('1/5 words')).toBeInTheDocument();
    expect(screen.getByText('0/1 done today')).toBeInTheDocument();
  });

  it('renders nothing while pitch accent is paused', async () => {
    await updateSettings({ pitchAccentPaused: true });
    const { container } = renderPanel();
    await waitFor(() => expect(drill.loads).toBeGreaterThan(0));
    await Promise.resolve();
    expect(container.textContent).toBe('');
  });
});
