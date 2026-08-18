import type { TimingObservation } from './timingObservations';

/**
 * Turns a pile of independently-generated observations
 * (`timingObservations.ts`, `wordTimingObservations.ts`,
 * `pitchTimingObservations.ts`) into a priority order, and picks the one
 * thing to surface as "Focus on this" (docs/STATUS.md Phase 9, Milestone
 * 5/6). Ranking is severity × confidence, not confidence alone — a
 * severe medium-confidence finding is more useful to practice than a
 * barely-noticeable high-confidence one.
 */

const CONFIDENCE_WEIGHT: Record<TimingObservation['confidence'], number> = {
  high: 1,
  medium: 0.7,
  low: 0.4,
};

function score(observation: TimingObservation): number {
  return (observation.severity ?? 0) * CONFIDENCE_WEIGHT[observation.confidence];
}

export function rankObservations(observations: TimingObservation[]): TimingObservation[] {
  return [...observations].sort((a, b) => score(b) - score(a));
}

/**
 * The single "Focus on this" candidate, or undefined when nothing has a
 * real severity — e.g. every observation so far is informational
 * (a reassuring "close to reference" note, a pitch-register comparison).
 * Never surfaces those as if they were an issue to fix.
 */
export function selectPrimaryObservation(
  observations: TimingObservation[],
): TimingObservation | undefined {
  const candidates = observations.filter((observation) => (observation.severity ?? 0) > 0);
  return rankObservations(candidates)[0];
}

/**
 * Below this severity gap, a "closer than last time" claim would be
 * asserting precision the underlying heuristic doesn't have — treat it as
 * "still the same issue," not an improvement (same "no fake precision"
 * posture as everywhere else in this feedback system).
 */
const IMPROVEMENT_EPSILON = 0.05;

export type ObservationComparison =
  | { status: 'nothing_to_compare' }
  | { status: 'resolved' }
  | {
      status: 'improved';
      kind: string;
      message: string;
      detail?: string;
      previousSeverity: number;
      currentSeverity: number;
    }
  | {
      status: 'same_or_worse';
      kind: string;
      message: string;
      detail?: string;
      previousSeverity: number;
      currentSeverity: number;
    }
  | { status: 'new_focus'; message: string; detail?: string };

/**
 * Compares a sentence's two most recent attempts' "Focus on this" picks
 * (docs/STATUS.md, cross-recording comparison follow-up) — pass
 * `undefined` for either side when that attempt had no `selectPrimaryObservation`
 * candidate (either no prior attempt exists at all, or it did but nothing
 * rose to "worth focusing on"). Deliberately reports a hedged severity
 * delta, not a percentage or score — this system's established convention
 * (Phase 9) is to never assert precision the underlying heuristics don't
 * have.
 */
export function compareObservations(
  previousPrimary: TimingObservation | undefined,
  currentPrimary: TimingObservation | undefined,
): ObservationComparison {
  if (!previousPrimary) return { status: 'nothing_to_compare' };
  if (!currentPrimary) return { status: 'resolved' };
  if (previousPrimary.kind === currentPrimary.kind) {
    const previousSeverity = previousPrimary.severity ?? 0;
    const currentSeverity = currentPrimary.severity ?? 0;
    const status =
      previousSeverity - currentSeverity > IMPROVEMENT_EPSILON ? 'improved' : 'same_or_worse';
    return {
      status,
      kind: currentPrimary.kind,
      message: currentPrimary.message,
      detail: currentPrimary.detail,
      previousSeverity,
      currentSeverity,
    };
  }
  return { status: 'new_focus', message: currentPrimary.message, detail: currentPrimary.detail };
}
