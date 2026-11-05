import { describe, expect, it } from 'vitest';

import { afterIndex, leadInIndex, liveWindowBuckets, nativeIndex, padBuckets } from '../src/lib/liveWindow';

// 100 buckets over 2 s of media: 50 buckets per media second.
const at1x = liveWindowBuckets(100, 2, 1, 0.5);

describe('live shadow window', () => {
  it('adds lead-in and pause buckets around the native span at the media scale', () => {
    expect(at1x).toMatchObject({ before: 50, native: 100, after: 25, total: 175 });
  });

  it('converts the wall-clock lead-in and pause at the playback rate, so half speed covers half as much media', () => {
    expect(liveWindowBuckets(100, 2, 1, 0.5, 0.5)).toMatchObject({ before: 25, after: 13, total: 138 });
  });

  it('is just the native span when there is no lead-in or pause', () => {
    expect(liveWindowBuckets(100, 2, 0, 0)).toMatchObject({ before: 0, after: 0, total: 100 });
    expect(liveWindowBuckets(100, 0, 1, 1)).toMatchObject({ before: 0, after: 0, total: 100 });
  });

  it('pads a native contour so it keeps its true position in the window', () => {
    const padded = padBuckets([1, 2, 3], liveWindowBuckets(3, 3, 1, 2), null as number | null);
    expect(padded).toEqual([null, 1, 2, 3, null, null]);
  });

  it('puts the learner at the left edge when the countdown starts and at the native start when it ends', () => {
    expect(leadInIndex(at1x, 1)).toBe(0);
    expect(leadInIndex(at1x, 0.5)).toBe(25);
    expect(leadInIndex(at1x, 0)).toBe(50);
    expect(leadInIndex(at1x, 5)).toBe(0);
  });

  it('follows the native through its span and never runs past it', () => {
    expect(nativeIndex(at1x, 0)).toBe(50);
    expect(nativeIndex(at1x, 0.5)).toBe(100);
    expect(nativeIndex(at1x, 1)).toBe(149);
    expect(nativeIndex(at1x, 7)).toBe(149);
  });

  it('keeps drawing into the pause after the native ends, then stops when the window is used up', () => {
    expect(afterIndex(at1x, 0)).toBe(150);
    expect(afterIndex(at1x, 0.2)).toBe(160);
    expect(afterIndex(at1x, 0.49)).toBe(174);
    expect(afterIndex(at1x, 0.5)).toBeNull();
  });

  it('has no after-window to draw into when there is no pause', () => {
    expect(afterIndex(liveWindowBuckets(100, 2, 1, 0), 0)).toBeNull();
  });
});
