import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../src/App';
import { resetDbForTests } from '../src/db/database';
import { withAppProviders } from '../src/test/providers';

const { SOURCE, TRANSCRIPT } = vi.hoisted(() => ({
  SOURCE: {
    id: 'source-vidmocked',
    type: 'youtube' as const,
    url: 'https://www.youtube.com/watch?v=vidmocked',
    videoId: 'vidmocked',
    title: 'Mocked Mining Video',
    channel: 'Mocked Channel',
    durationMs: 5000,
  },
  TRANSCRIPT: [
    { text: '今日は', startMs: 0, endMs: 1000, isAuto: false, lowConfidence: false },
    { text: '晴れです。', startMs: 1000, endMs: 2000, isAuto: false, lowConfidence: true },
    {
      text: 'そうですね。行きましょう。',
      startMs: 2000,
      endMs: 3200,
      isAuto: false,
      lowConfidence: false,
    },
  ],
}));

vi.mock('../src/lib/miningApi', () => {
  const cuesFromSegments = (
    segments: { text: string; startMs: number; endMs: number }[],
    passthrough: boolean,
  ) => {
    const cues: Record<string, unknown>[] = [];
    segments.forEach((seg, segIndex) => {
      const pieces = passthrough
        ? [seg.text]
        : seg.text
            .split(/(?<=[。！？])/)
            .map((t) => t.trim())
            .filter(Boolean);
      const per = (seg.endMs - seg.startMs) / Math.max(1, pieces.length);
      pieces.forEach((text, k) => {
        cues.push({
          index: cues.length,
          startMs: Math.round(seg.startMs + k * per),
          endMs: Math.round(seg.startMs + (k + 1) * per),
          japanese: text,
          isAuto: false,
          englishGuess: null,
          sourceIndexes: [segIndex],
        });
      });
    });
    return cues;
  };

  return {
    createMiningJob: vi.fn(async () => 'job-1'),
    getMiningJob: vi.fn(async () => ({
      jobId: 'job-1',
      status: 'ready' as const,
      stage: 'ready' as const,
      message: 'Ready — 3 segment(s).',
      source: SOURCE,
      transcript: TRANSCRIPT,
      cues: [],
      rows: [],
    })),
    applyJobSegments: vi.fn(
      async (
        _jobId: string,
        segments: { text: string; startMs: number; endMs: number }[],
        options: { merge?: boolean | null; split?: boolean } = {},
      ) => ({
        jobId: 'job-1',
        status: 'ready' as const,
        stage: 'segment' as const,
        message: '',
        source: SOURCE,
        cues: cuesFromSegments(
          segments,
          options.merge === false && options.split === false,
        ),
      }),
    ),
    translateJob: vi.fn(async () => ({
      jobId: 'job-1',
      status: 'ready' as const,
      stage: 'translate' as const,
      message: '',
      source: SOURCE,
      rows: [
        { index: 0, japanese: '今日は', english: 'Today', startMs: 0, endMs: 1000 },
        { index: 1, japanese: '晴れです。', english: 'It is sunny.', startMs: 1000, endMs: 2000 },
        { index: 2, japanese: 'そうですね。', english: 'Right.', startMs: 2000, endMs: 2600 },
        { index: 3, japanese: '行きましょう。', english: "Let's go.", startMs: 2600, endMs: 3200 },
      ],
    })),
    commitMiningJob: vi.fn(
      async (
        _jobId: string,
        rows: { japanese: string; english?: string; startMs: number; endMs: number }[],
      ) =>
        rows.map((row) => ({
          clip: {
            sentenceId: `sentence-${row.startMs}-mocked`,
            japanese: row.japanese,
            reading: null,
            english: row.english ?? null,
            startMs: row.startMs,
            endMs: row.endMs,
            subtitleStartMs: row.startMs,
            subtitleEndMs: row.endMs,
            adjustedStartMs: row.startMs,
            adjustedEndMs: row.endMs,
            transcriptStatus: 'manually-corrected' as const,
            tokens: null,
            audio: { mimeType: 'audio/mp4' as const, durationMs: row.endMs - row.startMs + 300 },
          },
          blob: new Blob(['fake-clip'], { type: 'audio/mp4' }),
        })),
    ),
    fetchJobAudioRange: vi.fn(async () => new Blob(['fake-span'], { type: 'audio/mp4' })),
    deleteMiningJob: vi.fn(async () => undefined),
  };
});

async function openNavMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'Open navigation menu' }));
}

beforeEach(() => {
  resetDbForTests(`ytmine-${Date.now()}`);
  window.history.replaceState({}, '', '/#/');
});

describe('YouTube mining wizard', () => {
  it('walks transcript → segment → translate → commit and imports', async () => {
    const { applyJobSegments, translateJob, commitMiningJob } = await import(
      '../src/lib/miningApi'
    );
    const user = userEvent.setup();
    render(withAppProviders(<App />));
    await openNavMenu(user);
    await user.click(await screen.findByRole('link', { name: 'Import from YouTube' }));

    await user.type(
      await screen.findByPlaceholderText('https://www.youtube.com/watch?v=…'),
      'https://www.youtube.com/watch?v=vidmocked',
    );
    await user.click(screen.getByRole('button', { name: 'Start' }));

    // Stage 1 — transcript segments are editable.
    expect(await screen.findByText(/step 1 of 4: Transcript/)).toBeInTheDocument();
    expect(await screen.findByDisplayValue('今日は')).toBeInTheDocument();
    expect(screen.getByText(/⚠ low confidence/)).toBeInTheDocument();

    // Fix a segment, then hand the corrected transcript to the segmenter.
    const segBox = screen.getByDisplayValue('今日は');
    await user.clear(segBox);
    await user.type(segBox, '今日は、');
    await user.click(screen.getByRole('button', { name: /Apply & segment/ }));

    // Stage 2 — the server split the bundled cue into two sentences.
    expect(await screen.findByText(/step 2 of 4: Segment/)).toBeInTheDocument();
    expect(applyJobSegments).toHaveBeenCalledWith(
      'job-1',
      expect.arrayContaining([expect.objectContaining({ text: '今日は、' })]),
    );
    expect(await screen.findByDisplayValue('そうですね。')).toBeInTheDocument();
    expect(screen.getByDisplayValue('行きましょう。')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Apply & translate/ }));

    // Stage 3 — EN aligned onto the final boundaries.
    expect(await screen.findByText(/step 3 of 4: Translate/)).toBeInTheDocument();
    expect(translateJob).toHaveBeenCalledWith('job-1');
    expect(await screen.findByDisplayValue("Let's go.")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next →' }));

    // Stage 4 — every reviewed row clipped in one commit call, then preview.
    expect(await screen.findByText('Import preview')).toBeInTheDocument();
    await waitFor(() => expect(commitMiningJob).toHaveBeenCalledTimes(1));
    expect(commitMiningJob).toHaveBeenCalledWith(
      'job-1',
      expect.arrayContaining([
        expect.objectContaining({ japanese: '行きましょう。', endMs: 3200 }),
      ]),
    );

    await user.click(screen.getByRole('button', { name: 'Import complete project' }));
    expect(
      await screen.findByRole('heading', { name: 'Mocked Mining Video' }),
    ).toBeInTheDocument();
  }, 30000);
});
