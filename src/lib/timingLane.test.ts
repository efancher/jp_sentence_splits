import { describe, expect, it } from 'vitest';
import { buildTimingLane } from './timingLane';
import type { KanaTimelineEntry } from './kanaTimeline';

const entry = (text: string, start: number, end: number, exact = true): KanaTimelineEntry => ({
  text, start, end, leftPct: 0, widthPct: 0, exact,
});

const ref = [entry('こ', 0.5, 0.7), entry('ん', 0.7, 0.9), entry('に', 0.9, 1.1)];

describe('buildTimingLane', () => {
  it('anchors each row at its first onset', () => {
    const lane = buildTimingLane({
      reference: ref,
      learner: [entry('こ', 2, 2.2), entry('ん', 2.2, 2.4), entry('に', 2.4, 2.6)],
      matchSpeed: false,
    })!;
    expect(lane.learner[0]!.start).toBeCloseTo(0);
    expect(lane.learner.every((m) => Math.abs(m.offsetSeconds!) < 1e-9)).toBe(true);
  });

  it('flags a late mora and keeps later ones relative', () => {
    const lane = buildTimingLane({
      reference: ref,
      learner: [entry('こ', 0, 0.2), entry('ん', 0.4, 0.6), entry('に', 0.6, 0.8)],
      matchSpeed: false,
    })!;
    expect(lane.learner[1]!.offsetSeconds).toBeCloseTo(0.2);
  });

  it('matchSpeed removes uniform slowness', () => {
    const slow = [entry('こ', 0, 0.4), entry('ん', 0.4, 0.8), entry('に', 0.8, 1.2)];
    const raw = buildTimingLane({ reference: ref, learner: slow, matchSpeed: false })!;
    const matched = buildTimingLane({ reference: ref, learner: slow, matchSpeed: true })!;
    expect(raw.speedRatio).toBeCloseTo(2);
    expect(raw.learner[2]!.offsetSeconds).toBeGreaterThan(0.3);
    expect(Math.abs(matched.learner[2]!.offsetSeconds!)).toBeLessThan(1e-9);
  });

  it('divides reference time by the practice rate', () => {
    const lane = buildTimingLane({
      reference: ref,
      learner: [entry('こ', 0, 0.4), entry('ん', 0.4, 0.8), entry('に', 0.8, 1.2)],
      matchSpeed: false,
      referenceRate: 0.5,
    })!;
    expect(lane.reference[2]!.start).toBeCloseTo(0.8);
    expect(lane.learner[2]!.offsetSeconds).toBeCloseTo(0);
  });

  it('skips offsets when mora counts differ and returns undefined when empty', () => {
    const lane = buildTimingLane({ reference: ref, learner: [], matchSpeed: false });
    expect(lane).toBeUndefined();
    const lane2 = buildTimingLane({
      reference: ref,
      learner: [entry('こ', 0, 0.2), entry('ん', 0.2, 0.4)],
      matchSpeed: false,
    })!;
    expect(lane2.paired).toBe(false);
    expect(lane2.learner[0]!.offsetSeconds).toBeUndefined();
  });
});
