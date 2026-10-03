import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SentenceAudioAdjuster } from '../src/components/SentenceAudioAdjuster';
import type { SentenceAudio } from '../src/domain/types';

const recutSentenceAudioFromSource = vi.fn(async (..._args: unknown[]) => ({ durationMs: 1200 }));
vi.mock('../src/db/repository', () => ({
  recutSentenceAudioFromSource: (...args: unknown[]) => recutSentenceAudioFromSource(...args),
}));
const fetchSourceAudioRange = vi.fn(async (..._args: unknown[]) => new Blob(['x'], { type: 'audio/mp4' }));
vi.mock('../src/lib/miningApi', () => ({
  fetchSourceAudioRange: (...args: unknown[]) => fetchSourceAudioRange(...args),
}));
// The real editor decodes audio and draws waveforms; here only its value/onSave contract matters.
vi.mock('../src/components/ZoomedRangeEditor', () => ({
  ZoomedRangeEditor: ({
    value,
    onSave,
    onCancel,
  }: {
    value: { startMs: number; endMs: number };
    onSave: (r: { startMs: number; endMs: number }) => void;
    onCancel: () => void;
  }) => (
    <div>
      <span>{`value ${value.startMs}-${value.endMs}`}</span>
      <button onClick={() => onSave({ startMs: value.startMs - 500, endMs: value.endMs })}>Save</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
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

beforeEach(() => {
  recutSentenceAudioFromSource.mockClear();
  fetchSourceAudioRange.mockClear();
});

describe('SentenceAudioAdjuster', () => {
  it('loads padded source audio and re-cuts using absolute source times', async () => {
    const user = userEvent.setup();
    render(<SentenceAudioAdjuster audio={audio} sourceUrl="https://youtu.be/VID" />);

    await user.click(screen.getByRole('button', { name: /adjust clip/i }));
    expect(await screen.findByText('value 4000-5200')).toBeInTheDocument();
    expect(fetchSourceAudioRange).toHaveBeenCalledWith('https://youtu.be/VID', 2000, 11200);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(recutSentenceAudioFromSource).toHaveBeenCalledWith('ra-1', { startMs: 5500, endMs: 7200 });
  });

  it('cancel closes without re-cutting', async () => {
    const user = userEvent.setup();
    render(<SentenceAudioAdjuster audio={audio} sourceUrl="https://youtu.be/VID" />);
    await user.click(screen.getByRole('button', { name: /adjust clip/i }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: /adjust clip/i })).toBeInTheDocument();
    expect(recutSentenceAudioFromSource).not.toHaveBeenCalled();
  });
});
