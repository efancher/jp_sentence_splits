/**
 * Pure geometry for the zoomed word-boundary edge editor
 * (`BoundaryEdgeEditor`): the visible window around an edge, converting
 * between pixels and milliseconds, and keeping the two edges in order.
 */

/** Half-width of the zoomed view: an edge is shown with this much audio either side. */
export const EDGE_WINDOW_HALF_MS = 400;

/** The edges may not be closer than this (no real word is shorter). */
export const MIN_SPAN_MS = 40;

export interface EdgeWindow {
  startMs: number;
  endMs: number;
}

/** The visible [start, end) for an edge, shifted (not shrunk) to stay inside the clip. */
export function edgeWindow(centerMs: number, durationMs: number, halfMs = EDGE_WINDOW_HALF_MS): EdgeWindow {
  const width = Math.min(durationMs, halfMs * 2);
  const start = Math.min(Math.max(0, centerMs - halfMs), Math.max(0, durationMs - width));
  return { startMs: start, endMs: start + width };
}

export function msAtX(x: number, width: number, window: EdgeWindow): number {
  const frac = Math.min(1, Math.max(0, x / width));
  return window.startMs + frac * (window.endMs - window.startMs);
}

export function xAtMs(ms: number, width: number, window: EdgeWindow): number {
  return ((ms - window.startMs) / (window.endMs - window.startMs)) * width;
}

/** Moves the start edge, keeping it inside the clip and before the end edge. */
export function clampStart(ms: number, endMs: number): number {
  return Math.round(Math.min(Math.max(0, ms), endMs - MIN_SPAN_MS));
}

/** Moves the end edge, keeping it inside the clip and after the start edge. */
export function clampEnd(ms: number, startMs: number, durationMs: number): number {
  return Math.round(Math.max(Math.min(durationMs, ms), startMs + MIN_SPAN_MS));
}

/** The ranges to audition for an edge: the audio just outside and just inside it. */
export function auditionRanges(
  kind: 'start' | 'end',
  edgeMs: number,
  durationMs: number,
  lengthMs = 300,
): { outside: { startMs: number; endMs: number }; inside: { startMs: number; endMs: number } } {
  const before = { startMs: Math.max(0, edgeMs - lengthMs), endMs: Math.max(0, edgeMs) };
  const after = { startMs: Math.min(durationMs, edgeMs), endMs: Math.min(durationMs, edgeMs + lengthMs) };
  // At a start edge the word is *after* it; at an end edge, *before*.
  return kind === 'start' ? { outside: before, inside: after } : { outside: after, inside: before };
}
