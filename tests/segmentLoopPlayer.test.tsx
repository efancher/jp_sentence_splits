import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SegmentLoopPlayer } from '../src/components/SegmentLoopPlayer';
import { getDb, resetDbForTests } from '../src/db/database';
import type { AlignmentResult, SentenceAudio, SentenceVocabulary } from '../src/domain/types';
import { createId } from '../src/lib/ids';

const loadOrComputeAlignment = vi.fn<() => Promise<AlignmentResult | undefined>>();
vi.mock('../src/lib/alignmentCache', () => ({
  loadOrComputeAlignment: (...args: unknown[]) =>
    (loadOrComputeAlignment as (...a: unknown[]) => unknown)(...args),
}));

// jsdom has no AudioContext: give the editor a fake decoded clip; skip real playback.
const decodeAudioBuffer = vi.fn(async (_blob: Blob): Promise<unknown> => ({
  duration: 3,
  sampleRate: 16000,
  numberOfChannels: 1,
  length: 48000,
  getChannelData: () => new Float32Array(48000),
}));
vi.mock('../src/lib/waveform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/waveform')>()),
  decodeAudioBuffer: (blob: Blob) => decodeAudioBuffer(blob),
}));
vi.mock('../src/lib/rangePlayer', () => ({
  RangePlayer: class {
    play = vi.fn(async () => undefined);
    stop = vi.fn();
    dispose = vi.fn();
  },
}));

const audio: SentenceAudio = {
  id: 'audio-1',
  sentenceId: 'sent-1',
  sourceId: 'src-1',
  durationMs: 3000,
  blob: new Blob(['reference-clip'], { type: 'audio/mp4' }),
  importedAt: new Date().toISOString(),
} as SentenceAudio;

const link = (over: Partial<SentenceVocabulary> = {}): SentenceVocabulary => ({
  id: 'link-1',
  sentenceId: 'sent-1',
  vocabularyItemId: 'vi-1',
  surfaceForm: '大学',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...over,
});

const ISOLATABLE: AlignmentResult = {
  durationSeconds: 3,
  words: [
    { start: 0, end: 1, text: '私', phones: [] },
    { start: 1, end: 2, text: '大学', phones: [] },
    { start: 2, end: 3, text: 'です', phones: [] },
  ],
};

beforeEach(() => {
  resetDbForTests(`slp-${createId('db')}`);
  loadOrComputeAlignment.mockReset();
});

describe('SegmentLoopPlayer word-audio range', () => {
  it('offers "Adjust" once a word span is resolved from alignment', async () => {
    loadOrComputeAlignment.mockResolvedValue(ISOLATABLE);
    render(
      <SegmentLoopPlayer audio={audio} japanese="私大学です" surfaceForm="大学" link={link()} />,
    );
    expect(await screen.findByRole('button', { name: 'Adjust' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /loop the native word/i })).toBeInTheDocument();
  });

  it('uses the manual override even when alignment cannot isolate the word', async () => {
    loadOrComputeAlignment.mockResolvedValue(undefined);
    render(
      <SegmentLoopPlayer
        audio={audio}
        japanese="私大学です"
        surfaceForm="大学"
        link={link({ audioStartMs: 900, audioEndMs: 1750 })}
      />,
    );
    // Loop control is available purely from the override.
    expect(await screen.findByRole('button', { name: /loop the native word/i })).toBeInTheDocument();
    const adjust = await screen.findByRole('button', { name: 'Adjusted' });

    await userEvent.setup().click(adjust);
    expect(await screen.findByRole('group', { name: /word audio range editor/i })).toBeInTheDocument();
  });

  it('still offers "Adjust" (seeded with a guess) when alignment cannot isolate the word', async () => {
    loadOrComputeAlignment.mockResolvedValue(undefined);
    render(
      <SegmentLoopPlayer audio={audio} japanese="私大学です" surfaceForm="大学" link={link()} />,
    );
    // No auto range and no saved override — but a link + known duration means
    // the learner can still place the span by ear.
    expect(await screen.findByText(/tap adjust to set it by ear/i)).toBeInTheDocument();
    const adjust = await screen.findByRole('button', { name: 'Adjust' });
    await userEvent.setup().click(adjust);
    expect(await screen.findByRole('group', { name: /word audio range editor/i })).toBeInTheDocument();
  });

  it('shows only the hint (no "Adjust") when there is no link to save a correction to', async () => {
    loadOrComputeAlignment.mockResolvedValue(undefined);
    render(<SegmentLoopPlayer audio={audio} japanese="私大学です" surfaceForm="大学" />);
    expect(await screen.findByText(/couldn.t isolate just the word/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Adjust/ })).not.toBeInTheDocument();
  });

  it('says the timing looks unreliable (not just "couldn\u2019t isolate") when a squashed token is next to the word', async () => {
    // 大学 is a normal-length word, but its neighbour 私 is crushed to 20 ms/mora — the aligner mis-timed this stretch.
    const squashed = (text: string, start: number, end: number): AlignmentResult['words'][number] => ({
      text, start, end, phones: [
        { text: 'k', start, end: start + (end - start) / 4 }, { text: 'a', start: start + (end - start) / 4, end: start + (end - start) / 2 },
        { text: 'k', start: start + (end - start) / 2, end: start + (3 * (end - start)) / 4 }, { text: 'a', start: start + (3 * (end - start)) / 4, end },
      ],
    });
    loadOrComputeAlignment.mockResolvedValue({
      durationSeconds: 3,
      words: [squashed('私', 0, 0.04), { start: 0.04, end: 2, text: '大学', phones: [] }, { start: 2, end: 3, text: 'です', phones: [] }],
    });
    render(<SegmentLoopPlayer audio={audio} japanese="私大学です" surfaceForm="大学" link={link()} />);
    expect(await screen.findByText(/the timing here looks unreliable — tap adjust/i)).toBeInTheDocument();
  });

  describe('the zoomed adjust editor', () => {
    const open = async (linkOver: Partial<SentenceVocabulary> = {}) => {
      loadOrComputeAlignment.mockResolvedValue(ISOLATABLE);
      const l = link(linkOver);
      await getDb().sentenceVocabulary.put(l as never);
      render(<SegmentLoopPlayer audio={audio} japanese="私大学です" surfaceForm="大学" link={l} />);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /^Adjust/ }));
      await screen.findByRole('slider', { name: /start edge/i }); // decoded and ready
      return user;
    };
    const stored = async () => (await getDb().sentenceVocabulary.get('link-1')) as SentenceVocabulary;

    it('writes nothing until Save, then stores the nudged span as the override', async () => {
      const user = await open();
      // auto span 大学 = 1000–2000 ms (+ a pad the loop adds); nudge the end out by 100 ms
      await user.click(screen.getByRole('button', { name: /move end edge 100 ms/i }));
      expect((await stored()).audioEndMs).toBeUndefined();
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(async () => expect((await stored()).audioEndMs).toBeDefined());
      const after = await stored();
      expect(after.audioEndMs! - after.audioStartMs!).toBeGreaterThan(1000); // the 100 ms went in
      expect(screen.queryByRole('group', { name: /word audio range editor/i })).not.toBeInTheDocument(); // closed
    });

    it('Cancel discards the edit; Save is disabled until something moved', async () => {
      const user = await open();
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: /move start edge -100 ms/i }));
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('group', { name: /word audio range editor/i })).not.toBeInTheDocument();
      expect((await stored()).audioStartMs).toBeUndefined();
    });

    it('Reset to automatic clears a saved override', async () => {
      const user = await open({ audioStartMs: 900, audioEndMs: 1750 });
      await user.click(screen.getByRole('button', { name: /reset to automatic/i }));
      await waitFor(async () => expect((await stored()).audioStartMs).toBeUndefined());
      expect((await stored()).audioEndMs).toBeUndefined();
    });
  });
});
