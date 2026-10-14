import type { KanaTimelineEntry } from './kanaTimeline';

export interface TimingLaneMark {
  text: string;
  /** Seconds from this row's first mora onset, after any speed matching. */
  start: number;
  end: number;
  exact: boolean;
  /** Learner onset minus reference onset, seconds (positive = late). Learner row only, when morae pair 1:1. */
  offsetSeconds?: number;
}

export interface TimingLane {
  reference: TimingLaneMark[];
  learner: TimingLaneMark[];
  /** Length of the shared time axis, seconds. */
  axisSeconds: number;
  /** Learner span / reference span before any speed matching. */
  speedRatio: number;
  /** True when the two rows have the same mora count, so per-mora offsets are meaningful. */
  paired: boolean;
}

const span = (entries: readonly KanaTimelineEntry[]) =>
  entries[entries.length - 1]!.end - entries[0]!.start;

/**
 * Lays native and learner mora onsets on one real-time axis, each anchored at
 * its own first onset so leading silence doesn't read as lateness. With
 * `matchSpeed`, the learner is scaled to the reference's overall span so a
 * uniformly slower take doesn't flag every mora as late and only local
 * rhythm differences remain. `referenceRate` is the practice playback rate
 * the learner shadowed at (reference alignment is at 1x).
 */
export function buildTimingLane({
  reference,
  learner,
  matchSpeed,
  referenceRate = 1,
}: {
  reference: readonly KanaTimelineEntry[];
  learner: readonly KanaTimelineEntry[];
  matchSpeed: boolean;
  referenceRate?: number;
}): TimingLane | undefined {
  if (reference.length === 0 || learner.length === 0) return undefined;
  const rate = referenceRate > 0 ? referenceRate : 1;
  const refOrigin = reference[0]!.start;
  const learnerOrigin = learner[0]!.start;
  const refSpan = span(reference) / rate;
  const learnerSpan = span(learner);
  if (refSpan <= 0 || learnerSpan <= 0) return undefined;
  const speedRatio = learnerSpan / refSpan;
  const learnerScale = matchSpeed ? 1 / speedRatio : 1;
  const paired = reference.length === learner.length;

  const refMarks: TimingLaneMark[] = reference.map((e) => ({
    text: e.text,
    start: (e.start - refOrigin) / rate,
    end: (e.end - refOrigin) / rate,
    exact: e.exact,
  }));
  const learnerMarks: TimingLaneMark[] = learner.map((e, i) => {
    const start = (e.start - learnerOrigin) * learnerScale;
    return {
      text: e.text,
      start,
      end: (e.end - learnerOrigin) * learnerScale,
      exact: e.exact,
      offsetSeconds: paired ? start - refMarks[i]!.start : undefined,
    };
  });
  const axisSeconds = Math.max(
    refMarks[refMarks.length - 1]!.end,
    learnerMarks[learnerMarks.length - 1]!.end,
  );
  return { reference: refMarks, learner: learnerMarks, axisSeconds, speedRatio, paired };
}
