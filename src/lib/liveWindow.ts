/**
 * Timeline of the live shadow chart. The native contour sits in the middle at its true timing; the chart
 * also covers the lead-in before it and the pause after it, so the learner's voice is drawn from the moment
 * recording starts (and keeps drawing past the native's end, where a shadow always trails) instead of being
 * squeezed into, or cut off at, the native's own span. Pure: the component feeds it clocks.
 *
 * Buckets are slices of equal *media* time: the native clip's `native` buckets cover `durationSeconds` of
 * media, and the lead-in / pause (wall-clock seconds) are converted at the playback rate, so the chart's
 * scale never changes with speed.
 */
export interface LiveWindow {
  /** Buckets before the native contour (the lead-in). */
  before: number;
  /** Buckets of the native contour itself. */
  native: number;
  /** Buckets after it (the pause). */
  after: number;
  total: number;
  /** Buckets per second of media time. */
  perMediaSecond: number;
  /** Media seconds per wall-clock second at the current speed. */
  rate: number;
}

export function liveWindowBuckets(
  nativeBuckets: number,
  durationSeconds: number,
  leadInSeconds: number,
  tailSeconds: number,
  rate = 1,
): LiveWindow {
  const safeRate = rate > 0 ? rate : 1;
  const perMediaSecond = durationSeconds > 0 ? nativeBuckets / durationSeconds : 0;
  const before = Math.max(0, Math.round(leadInSeconds * safeRate * perMediaSecond));
  const after = Math.max(0, Math.round(tailSeconds * safeRate * perMediaSecond));
  return { before, native: nativeBuckets, after, total: before + nativeBuckets + after, perMediaSecond, rate: safeRate };
}

/** `values` with `before` / `after` copies of `fill` either side. */
export function padBuckets<T>(values: readonly T[], window: LiveWindow, fill: T): T[] {
  return [
    ...Array.from({ length: window.before }, () => fill),
    ...values,
    ...Array.from({ length: window.after }, () => fill),
  ];
}

/** Bucket for the learner's voice while the lead-in countdown has `remainingSeconds` (wall clock) left. */
export function leadInIndex(window: LiveWindow, remainingSeconds: number): number {
  const back = Math.ceil(Math.max(0, remainingSeconds) * window.rate * window.perMediaSecond);
  return Math.max(0, window.before - back);
}

/** Bucket while the native plays, `progress` (0..1) through its span. */
export function nativeIndex(window: LiveWindow, progress: number): number {
  const within = Math.min(window.native - 1, Math.max(0, Math.floor(progress * window.native)));
  return window.before + within;
}

/** Bucket `elapsedSeconds` (wall clock) after the native ended, or null once past the pause window. */
export function afterIndex(window: LiveWindow, elapsedSeconds: number): number | null {
  const index = window.before + window.native + Math.floor(Math.max(0, elapsedSeconds) * window.rate * window.perMediaSecond);
  return index < window.total ? index : null;
}
