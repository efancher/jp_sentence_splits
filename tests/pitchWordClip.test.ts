import { describe, expect, it } from 'vitest';

import { cropPitchPayload, inWordShape, isPlausibleClipSpan, shapeLabel } from '../src/lib/pitchWordClip';

describe('inWordShape / shapeLabel', () => {
  it('gives the in-word h/l shape; heiban and odaka collapse to one', () => {
    expect(inWordShape('はし', 1)).toEqual({ moraCount: 2, shape: 'hl' }); // atamadaka
    expect(inWordShape('はし', 0)).toEqual({ moraCount: 2, shape: 'lh' }); // heiban
    expect(inWordShape('はし', 2)).toEqual({ moraCount: 2, shape: 'lh' }); // odaka — identical in-word
    expect(inWordShape('さくら', 0)!.shape).toBe('lhh');
    expect(inWordShape('あ', 0)).toBeNull(); // one mora: no contrast
  });

  it('describes shapes in plain language', () => {
    expect(shapeLabel('hll')).toMatch(/atamadaka/);
    expect(shapeLabel('lhh')).toMatch(/heiban \/ odaka/);
    expect(shapeLabel('lhl')).toMatch(/drops after mora 2 \(nakadaka\)/);
    expect(shapeLabel('lhhl')).toMatch(/after mora 3/);
  });

  it('bounds an isolated clip length', () => {
    expect(isPlausibleClipSpan({ startMs: 0, endMs: 50 })).toBe(false);
    expect(isPlausibleClipSpan({ startMs: 0, endMs: 250 })).toBe(false);
    expect(isPlausibleClipSpan({ startMs: 0, endMs: 500 })).toBe(true);
    expect(isPlausibleClipSpan({ startMs: 0, endMs: 9000 })).toBe(false);
  });
});

describe('cropPitchPayload', () => {
  it('keeps only frames inside the span, re-based to t=0', () => {
    const frame = (t: number) => ({ timeSeconds: t, hz: 100, relativeSemitones: 0, voiced: true }) as never;
    const cropped = cropPitchPayload(
      { frames: [frame(0.05), frame(0.2), frame(0.4), frame(0.9)], medianHz: 100, voicedRatio: 1, durationSeconds: 1 },
      { startMs: 150, endMs: 500 },
    );
    expect(cropped.frames.map((f) => f.timeSeconds)).toEqual([expect.closeTo(0.05, 5), expect.closeTo(0.25, 5)]);
    expect(cropped.durationSeconds).toBeCloseTo(0.35, 5);
  });
});
