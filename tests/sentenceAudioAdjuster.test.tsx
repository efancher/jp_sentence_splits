import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SentenceAudioAdjuster } from '../src/components/SentenceAudioAdjuster';
import type { SentenceAudio } from '../src/domain/types';

const recutSentenceAudioFromSource = vi.fn(async () => ({ durationMs: 1200 }));
vi.mock('../src/db/repository', () => ({
  recutSentenceAudioFromSource: (...args: unknown[]) =>
    (recutSentenceAudioFromSource as (...a: unknown[]) => unknown)(...args),
}));
vi.mock('../src/lib/miningApi', () => ({
  fetchSourceWaveform: vi.fn(async () => ({ peaks: [], silenceMidsMs: [] })),
  fetchSourceAudioRange: vi.fn(async () => new Blob(['x'], { type: 'audio/mp4' })),
}));

const audio: SentenceAudio = {
  id: 'ra-1',
  sentenceId: 'sent-1',
  sourceId: 'src-1',
  sourceSentenceId: 'src-1:0',
  sourceTitle: 'Vid',
  sourceUrl: 'https://youtu.be/VID',
  mimeType: 'audio/mp4',
  durationMs: 1200,
  startMs: 6000,
  endMs: 7200,
  blob: new Blob(['clip'], { type: 'audio/mp4' }),
  importedAt: new Date().toISOString(),
};

beforeEach(() => recutSentenceAudioFromSource.mockClear());

describe('SentenceAudioAdjuster', () => {
  it('opens the waveform editor on demand and gates Save on an edit', async () => {
    const user = userEvent.setup();
    render(<SentenceAudioAdjuster audio={audio} sourceUrl="https://youtu.be/VID" />);

    await user.click(screen.getByRole('button', { name: /adjust clip/i }));
    expect(
      await screen.findByRole('img', { name: /sentence waveform/i }),
    ).toBeInTheDocument();

    // No edit yet → Save & re-cut disabled, and no re-cut fired.
    expect(screen.getByRole('button', { name: /save & re-cut/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('img', { name: /sentence waveform/i })).not.toBeInTheDocument();
    expect(recutSentenceAudioFromSource).not.toHaveBeenCalled();
  });
});
