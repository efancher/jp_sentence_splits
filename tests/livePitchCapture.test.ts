import { describe, expect, it } from 'vitest';

import { LIVE_PITCH_CAPTURE_MAX_ENTRIES, LivePitchCapture, float32ToBase64 } from '../src/lib/livePitchCapture';

const entry = (i: number) => ({
  at: i,
  rawMediaTime: i / 10,
  leadInRemainingMs: 0,
  held: false,
  index: i,
  frame: new Float32Array([i, 0.5]),
  voiced: true,
  hz: 140,
  confidence: 0.9,
  guardedHz: 140,
});

describe('LivePitchCapture', () => {
  it('keeps only the most recent entries', () => {
    const capture = new LivePitchCapture();
    for (let i = 0; i < LIVE_PITCH_CAPTURE_MAX_ENTRIES + 10; i += 1) capture.push(entry(i));
    expect(capture.size).toBe(LIVE_PITCH_CAPTURE_MAX_ENTRIES);
    const parsed = JSON.parse(capture.toJson({ sampleRate: 48000 }));
    expect(parsed.entries[0].index).toBe(10);
    expect(parsed.meta.sampleRate).toBe(48000);
  });

  it('round-trips frames through base64 as float32', () => {
    const encoded = float32ToBase64(new Float32Array([0.25, -1.5]));
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    expect(Array.from(new Float32Array(bytes.buffer))).toEqual([0.25, -1.5]);
  });
});
