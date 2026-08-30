import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchCuePreviewAudio } from '../src/lib/miningApi';

import App from '../src/App';
import { resetDbForTests } from '../src/db/database';
import { withAppProviders } from '../src/test/providers';

// vi.mock factories are hoisted above other top-level declarations, so
// data the factory closes over must go through vi.hoisted() — a plain
// top-level const here would throw "cannot access before initialization".
const { CUES } = vi.hoisted(() => ({
  CUES: [
    { index: 0, startMs: 0, endMs: 1000, japanese: '今日は晴れです。', isAuto: false, englishGuess: 'It is sunny today.' },
    { index: 1, startMs: 1000, endMs: 2000, japanese: '散歩に行きましょう。', isAuto: false, englishGuess: "Let's go for a walk." },
  ],
}));

vi.mock('../src/lib/miningApi', () => ({
  createMiningJob: vi.fn(async () => 'job-1'),
  getMiningJob: vi.fn(async () => ({
    jobId: 'job-1',
    status: 'ready' as const,
    stage: 'Ready — 2 sentence(s) found.',
    source: {
      id: 'source-vidmocked',
      type: 'youtube' as const,
      url: 'https://www.youtube.com/watch?v=vidmocked',
      videoId: 'vidmocked',
      title: 'Mocked Mining Video',
      channel: 'Mocked Channel',
      durationMs: 5000,
    },
    cues: CUES,
  })),
  clipMiningCue: vi.fn(async (_jobId: string, cueIndex: number, options: { japanese: string; english?: string }) => {
    const cue = CUES[cueIndex]!;
    return {
      sentenceId: `sentence-00${cueIndex + 1}-mocked`,
      japanese: options.japanese,
      reading: null,
      english: options.english ?? null,
      startMs: cue.startMs,
      endMs: cue.endMs,
      subtitleStartMs: cue.startMs,
      subtitleEndMs: cue.endMs,
      adjustedStartMs: cue.startMs,
      adjustedEndMs: cue.endMs,
      transcriptStatus: 'manually-corrected' as const,
      tokens: null,
      audio: { mimeType: 'audio/mp4' as const, durationMs: cue.endMs - cue.startMs + 300 },
    };
  }),
  fetchMiningClipAudio: vi.fn(async () => new Blob(['fake-clip'], { type: 'audio/mp4' })),
  fetchCuePreviewAudio: vi.fn(async () => new Blob(['fake-cue'], { type: 'audio/mp4' })),
  deleteMiningJob: vi.fn(async () => undefined),
}));

async function openNavMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'Open navigation menu' }));
}

beforeEach(() => {
  resetDbForTests(`ytmine-${Date.now()}`);
  window.history.replaceState({}, '', '/#/');
});

describe('YouTube mining page', () => {
  it('mines a video, reviews both cues, and imports the resulting book', async () => {
    const user = userEvent.setup();
    render(withAppProviders(<App />));
    await openNavMenu(user);
    await user.click(await screen.findByRole('link', { name: 'Import from YouTube' }));

    await user.type(
      await screen.findByPlaceholderText('https://www.youtube.com/watch?v=…'),
      'https://www.youtube.com/watch?v=vidmocked',
    );
    await user.click(screen.getByRole('button', { name: 'Start' }));

    expect(await screen.findByText('Cue 1 / 2')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('今日は晴れです。')).toBeInTheDocument();

    // The cue's audio is fetched and rendered so it can be heard before keeping.
    await waitFor(() =>
      expect(document.querySelector('audio')).toBeInTheDocument(),
    );
    expect(fetchCuePreviewAudio).toHaveBeenCalledWith('job-1', 0);

    await user.click(screen.getByRole('button', { name: 'Keep & clip' }));

    expect(await screen.findByText('Cue 2 / 2')).toBeInTheDocument();
    await waitFor(() => expect(fetchCuePreviewAudio).toHaveBeenCalledWith('job-1', 1));
    await user.click(screen.getByRole('button', { name: 'Keep & clip' }));

    expect(await screen.findByText('Import preview')).toBeInTheDocument();
    expect(screen.getByText('Mocked Mining Video')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Import complete project' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Mocked Mining Video' }),
    ).toBeInTheDocument();
  }, 30000);
});
