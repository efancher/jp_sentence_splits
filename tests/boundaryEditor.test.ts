import { describe, expect, it } from 'vitest';

import {
  auditionRanges,
  clampEnd,
  clampStart,
  edgeWindow,
  MIN_SPAN_MS,
  msAtX,
  xAtMs,
} from '../src/lib/boundaryEditor';

describe('edgeWindow', () => {
  it('centres ±400 ms on the edge', () => {
    expect(edgeWindow(2000, 5000)).toEqual({ startMs: 1600, endMs: 2400 });
  });

  it('shifts, without shrinking, to stay inside the clip', () => {
    expect(edgeWindow(100, 5000)).toEqual({ startMs: 0, endMs: 800 });
    expect(edgeWindow(4950, 5000)).toEqual({ startMs: 4200, endMs: 5000 });
  });

  it('uses the whole clip when it is shorter than the window', () => {
    expect(edgeWindow(200, 500)).toEqual({ startMs: 0, endMs: 500 });
  });
});

describe('pixel ↔ ms', () => {
  const win = { startMs: 1000, endMs: 1800 };

  it('round-trips and clamps to the window', () => {
    expect(msAtX(300, 600, win)).toBe(1400);
    expect(xAtMs(1400, 600, win)).toBe(300);
    expect(msAtX(-50, 600, win)).toBe(1000);
    expect(msAtX(9999, 600, win)).toBe(1800);
  });
});

describe('edge clamping', () => {
  it('keeps the start inside the clip and before the end', () => {
    expect(clampStart(-20, 1000)).toBe(0);
    expect(clampStart(990, 1000)).toBe(1000 - MIN_SPAN_MS);
    expect(clampStart(500.6, 1000)).toBe(501);
  });

  it('keeps the end inside the clip and after the start', () => {
    expect(clampEnd(9999, 500, 3000)).toBe(3000);
    expect(clampEnd(510, 500, 3000)).toBe(500 + MIN_SPAN_MS);
  });
});

describe('auditionRanges', () => {
  it('at a start edge the word is after it; at an end edge, before it', () => {
    expect(auditionRanges('start', 1000, 5000)).toEqual({
      outside: { startMs: 700, endMs: 1000 },
      inside: { startMs: 1000, endMs: 1300 },
    });
    expect(auditionRanges('end', 1800, 5000)).toEqual({
      outside: { startMs: 1800, endMs: 2100 },
      inside: { startMs: 1500, endMs: 1800 },
    });
  });

  it('never runs outside the clip', () => {
    expect(auditionRanges('start', 100, 5000).outside).toEqual({ startMs: 0, endMs: 100 });
    expect(auditionRanges('end', 4900, 5000).outside).toEqual({ startMs: 4900, endMs: 5000 });
  });
});
