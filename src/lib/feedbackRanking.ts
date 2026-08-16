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
