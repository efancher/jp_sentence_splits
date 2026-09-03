import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SegmentLoopPlayer } from '../src/components/SegmentLoopPlayer';
import { resetDbForTests } from '../src/db/database';
import type { AlignmentResult, SentenceAudio, SentenceVocabulary } from '../src/domain/types';
import { createId } from '../src/lib/ids';

const loadOrComputeAlignment = vi.fn<() => Promise<AlignmentResult | undefined>>();
vi.mock('../src/lib/alignmentCache', () => ({
  loadOrComputeAlignment: (...args: unknown[]) =>
    (loadOrComputeAlignment as (...a: unknown[]) => unknown)(...args),
}));

const audio: SentenceAudio = {
  id: 'audio-1',
  sentenceId: 'sent-1',
  sourceId: 'src-1',
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
    expect(await screen.findByRole('img', { name: /word audio range editor/i })).toBeInTheDocument();
  });

  it('falls back to the hint when there is neither alignment nor override', async () => {
    loadOrComputeAlignment.mockResolvedValue(undefined);
    render(
      <SegmentLoopPlayer audio={audio} japanese="私大学です" surfaceForm="大学" link={link()} />,
    );
    expect(await screen.findByText(/couldn.t isolate just the word/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Adjust/ })).not.toBeInTheDocument();
  });
});
