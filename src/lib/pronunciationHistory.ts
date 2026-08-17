import type { TimingObservation } from './timingObservations';

/**
 * Summarizes a single attempt's analysis into the two trend categories
 * the brief's own history example uses (Timing, Pitch) and turns a
 * sequence of those summaries into "needs work" -> "improving" -> "close"
 * labels by comparing each attempt to the previous one for the same
 * sentence (docs/STATUS.md Phase 9, Milestone 8). Deliberately stores a
 * lightweight summary, not every derived observation forever — the full
 * detail is already recomputable on demand from the cached
 * alignment/transcription (Milestones 2b/7).
 */

export const ANALYSIS_SUMMARY_VERSION = 1;

const TIMING_KINDS = new Set(['duration', 'word-duration', 'sokuon_timing', 'long_vowel_timing']);
const PITCH_KINDS = new Set(['pitch', 'pitch_timing', 'pitch_shape']);

function maxSeverity(observations: TimingObservation[], kinds: Set<string>): number {
  let max = 0;
  for (const observation of observations) {
    if (!kinds.has(observation.kind)) continue;
    max = Math.max(max, observation.severity ?? 0);
  }
  return max;
}

export function categorizeObservations(observations: TimingObservation[]): {
  timingSeverity: number;
  pitchSeverity: number;
} {
  return {
    timingSeverity: maxSeverity(observations, TIMING_KINDS),
    pitchSeverity: maxSeverity(observations, PITCH_KINDS),
  };
}

export type TrendLabel = 'close' | 'needs work' | 'improving' | 'much closer';

const MUCH_CLOSER_THRESHOLD = 0.15;
const IMPROVING_RATIO = 0.7;

export function trendLabel(current: number, previous: number | undefined): TrendLabel {
  if (current <= 0) return 'close';
  if (previous === undefined || previous <= 0) return 'needs work';
  if (current < previous * IMPROVING_RATIO) {
    return current < MUCH_CLOSER_THRESHOLD ? 'much closer' : 'improving';
  }
  return 'needs work';
}

export interface AttemptAnalysisSummaryLike {
  id: string;
  createdAt: string;
  timingSeverity: number;
  pitchSeverity: number;
}

export interface HistoryEntry<T extends AttemptAnalysisSummaryLike> {
  summary: T;
  timingLabel: TrendLabel;
  pitchLabel: TrendLabel;
}

/** `summaries` need not be pre-sorted — sorted oldest-first internally so each entry compares to its true predecessor. */
export function buildHistoryDisplay<T extends AttemptAnalysisSummaryLike>(
  summaries: T[],
): HistoryEntry<T>[] {
  const chronological = [...summaries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const entries: HistoryEntry<T>[] = [];
  let previous: T | undefined;
  for (const summary of chronological) {
    entries.push({
      summary,
      timingLabel: trendLabel(summary.timingSeverity, previous?.timingSeverity),
      pitchLabel: trendLabel(summary.pitchSeverity, previous?.pitchSeverity),
    });
    previous = summary;
  }
  return entries;
}
