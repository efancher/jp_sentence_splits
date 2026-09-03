import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PitchAnalysisPayload } from '../src/lib/pitch';
import { loadOrComputeReferencePitch } from '../src/lib/referencePitchCache';
import * as waveform from '../src/lib/waveform';

vi.mock('../src/lib/waveform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/waveform')>()),
  decodeAudioBuffer: vi.fn(),
  canonicalizeAudioBuffer: vi.fn(),
}));

const SAMPLE_RATE = 16_000;

/** A short voiced sine so the real `extractPitch` yields voiced frames. */
function sineCanonical(hz = 180, seconds = 0.25) {
  const length = Math.round(SAMPLE_RATE * seconds);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    samples[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE);
  }
  return { samples, sampleRate: SAMPLE_RATE, durationSeconds: seconds };
}

describe('loadOrComputeReferencePitch', () => {
  const blob = new Blob(['x'], { type: 'audio/webm' });
  let store: Map<string, PitchAnalysisPayload>;
  const get = (id: string) => Promise.resolve(store.get(id));
  const save = (id: string, payload: PitchAnalysisPayload) => {
    store.set(id, payload);
    return Promise.resolve();
  };

  beforeEach(() => {
    store = new Map();
    vi.mocked(waveform.decodeAudioBuffer).mockReset();
    vi.mocked(waveform.canonicalizeAudioBuffer).mockReset();
  });

  it('returns the cached payload without decoding', async () => {
    const cached = { frames: [], medianHz: 100, voicedRatio: 0, durationSeconds: 1 };
    store.set('a', cached);

    const result = await loadOrComputeReferencePitch('a', blob, get, save);

    expect(result).toBe(cached);
    expect(waveform.decodeAudioBuffer).not.toHaveBeenCalled();
  });

  it('computes, saves, and returns on a cache miss', async () => {
    vi.mocked(waveform.decodeAudioBuffer).mockResolvedValue({} as AudioBuffer);
    vi.mocked(waveform.canonicalizeAudioBuffer).mockReturnValue(sineCanonical());

    const result = await loadOrComputeReferencePitch('b', blob, get, save);

    expect(waveform.decodeAudioBuffer).toHaveBeenCalledWith(blob);
    expect(result?.frames.some((frame) => frame.voiced)).toBe(true);
    expect(store.get('b')).toBe(result);
  });

  it('returns undefined (and does not save) when decoding fails', async () => {
    vi.mocked(waveform.decodeAudioBuffer).mockRejectedValue(new Error('no AudioContext'));

    const result = await loadOrComputeReferencePitch('c', blob, get, save);

    expect(result).toBeUndefined();
    expect(store.has('c')).toBe(false);
  });
});
