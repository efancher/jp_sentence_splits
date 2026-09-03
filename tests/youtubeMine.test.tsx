import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../src/App';
import { resetDbForTests } from '../src/db/database';
import { getDb } from '../src/db/repository';
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
      transcriptSource: 'asr' as const,
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
    fetchJobWaveform: vi.fn(async () => ({ peaks: [], silenceMidsMs: [] })),
    deleteMiningJob: vi.fn(async () => undefined),
    listMiningJobs: vi.fn(async () => []),
  };
});

async function openNavMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'Open navigation menu' }));
}

beforeEach(() => {
  resetDbForTests(`ytmine-${Date.now()}`);
  window.history.replaceState({}, '', '/#/');
  localStorage.clear();
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

    // "Translate with AI help" — paste a partial numbered reply; only the
    // covered rows change, the rest keep their aligned English.
    await user.click(screen.getByText('Translate with AI help'));
    await user.type(
      screen.getByPlaceholderText(/Paste the assistant's reply here/),
      '1. Good afternoon.{Enter}3. Yes, that is right.',
    );
    await user.click(screen.getByRole('button', { name: 'Apply pasted translations' }));
    expect(await screen.findByDisplayValue('Good afternoon.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Yes, that is right.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('It is sunny.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next →' }));

    // Stage 4 — every reviewed row clipped in one commit call, then preview.
    expect(await screen.findByText('Import preview')).toBeInTheDocument();
    await waitFor(() => expect(commitMiningJob).toHaveBeenCalledTimes(1));
    expect(commitMiningJob).toHaveBeenCalledWith(
      'job-1',
      expect.arrayContaining([
        expect.objectContaining({ japanese: '行きましょう。', endMs: 3200 }),
      ]),
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );

    await user.click(screen.getByRole('button', { name: 'Import complete project' }));
    expect(
      await screen.findByRole('heading', { name: 'Mocked Mining Video' }),
    ).toBeInTheDocument();
  }, 30000);

  it('warns when the pasted URL points at an already-imported video', async () => {
    await getDb().books.put({
      id: 'book-existing',
      title: 'Mocked Mining Video',
      sourceKey: 'shadowing:source-ptXJnNgYhi8',
      sourceUrl: 'https://www.youtube.com/watch?v=ptXJnNgYhi8',
      archived: false,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      chapters: [],
      collapsedChapterIds: [],
    });

    const user = userEvent.setup();
    render(withAppProviders(<App />));
    await openNavMenu(user);
    await user.click(await screen.findByRole('link', { name: 'Import from YouTube' }));

    const input = await screen.findByPlaceholderText('https://www.youtube.com/watch?v=…');
    await user.type(input, 'https://www.youtube.com/watch?v=ptXJnNgYhi8&t=30s');

    expect(
      await screen.findByText(/Already imported as .*Mocked Mining Video/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mine again' })).toBeInTheDocument();
  }, 30000);

  it('reconnects to an in-flight job on mount instead of showing the URL field', async () => {
    const { getMiningJob } = await import('../src/lib/miningApi');
    // A job left mid-pipeline (user refreshed on the Segment step).
    vi.mocked(getMiningJob).mockResolvedValue({
      jobId: 'job-resume',
      status: 'ready',
      stage: 'segment',
      message: '2 sentence(s) segmented.',
      source: SOURCE,
      cues: [
        {
          index: 0,
          startMs: 0,
          endMs: 1500,
          japanese: 'おはよう。',
          isAuto: true,
          lowConfidence: false,
          sourceIndexes: [0],
        },
        {
          index: 1,
          startMs: 1500,
          endMs: 3000,
          japanese: '元気ですか。',
          isAuto: true,
          lowConfidence: false,
          sourceIndexes: [1],
        },
      ],
    } as Awaited<ReturnType<typeof getMiningJob>>);
    localStorage.setItem(
      'ytmine.activeJob',
      JSON.stringify({ jobId: 'job-resume', savedAt: Date.now() }),
    );

    const user = userEvent.setup();
    render(withAppProviders(<App />));
    await openNavMenu(user);
    await user.click(await screen.findByRole('link', { name: 'Import from YouTube' }));

    expect(await screen.findByText(/step 2 of 4: Segment/)).toBeInTheDocument();
    expect(await screen.findByDisplayValue('おはよう。')).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('https://www.youtube.com/watch?v=…'),
    ).not.toBeInTheDocument();
    // ASR transcript → no auto-caption warning.
    expect(screen.queryByText(/Segmented from YouTube auto-captions/)).not.toBeInTheDocument();
  }, 30000);

  it('warns on the Segment stage when the job fell back to auto-captions', async () => {
    const { getMiningJob } = await import('../src/lib/miningApi');
    vi.mocked(getMiningJob).mockResolvedValue({
      jobId: 'job-cap',
      status: 'ready',
      stage: 'segment',
      message: '1 sentence(s) segmented.',
      source: SOURCE,
      transcriptSource: 'auto-caption',
      cues: [
        {
          index: 0,
          startMs: 0,
          endMs: 2000,
          japanese: 'おはよう。',
          isAuto: true,
          lowConfidence: false,
          sourceIndexes: [0],
        },
      ],
    } as Awaited<ReturnType<typeof getMiningJob>>);
    localStorage.setItem(
      'ytmine.activeJob',
      JSON.stringify({ jobId: 'job-cap', savedAt: Date.now() }),
    );

    const user = userEvent.setup();
    render(withAppProviders(<App />));
    await openNavMenu(user);
    await user.click(await screen.findByRole('link', { name: 'Import from YouTube' }));

    expect(await screen.findByText(/step 2 of 4: Segment/)).toBeInTheDocument();
    expect(
      await screen.findByText(/Segmented from YouTube auto-captions/),
    ).toBeInTheDocument();
    expect(screen.getByText(/±0\.5/)).toBeInTheDocument();
  }, 30000);

  it('offers server-held jobs on the idle screen and resumes the picked one', async () => {
    const { listMiningJobs, getMiningJob } = await import('../src/lib/miningApi');
    // No local pointer (started on another device) — the job comes from GET /jobs.
    vi.mocked(listMiningJobs).mockResolvedValueOnce([
      {
        jobId: 'job-elsewhere',
        url: 'https://www.youtube.com/watch?v=vidmocked',
        title: 'Started This Morning',
        status: 'ready',
        stage: 'ready',
        message: 'Ready — 2 sentence(s) found.',
        createdAt: Date.now() / 1000,
      },
    ]);
    vi.mocked(getMiningJob).mockResolvedValue({
      jobId: 'job-elsewhere',
      status: 'ready',
      stage: 'transcript',
      message: 'Ready — 2 sentence(s) found.',
      source: SOURCE,
      transcript: TRANSCRIPT,
      cues: [],
      rows: [],
    } as Awaited<ReturnType<typeof getMiningJob>>);

    const user = userEvent.setup();
    render(withAppProviders(<App />));
    await openNavMenu(user);
    await user.click(await screen.findByRole('link', { name: 'Import from YouTube' }));

    await user.click(await screen.findByRole('button', { name: /Started This Morning/ }));

    expect(await screen.findByText(/step 1 of 4: Transcript/)).toBeInTheDocument();
    expect(getMiningJob).toHaveBeenCalledWith('job-elsewhere');
    expect(localStorage.getItem('ytmine.activeJob')).toContain('job-elsewhere');
  }, 30000);
});
