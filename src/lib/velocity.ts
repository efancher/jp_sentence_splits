import type { WeekBucket } from './progressReport';

/**
 * "Velocity / ETA" (docs/ROADMAP.md "Possibilities" — surface the new-card-
 * backlog drain rate `report:new-card-backlog` already computes, plus
 * ~words/week, together as a single "at this rate" estimate).
 * `countNewVocabularyCardBacklog` (`repository.ts`) already gives the raw
 * backlog size and `buildProgressReport`'s `weeks` already gives a
 * words-learned-per-week trend — this is purely a combination of the two,
 * no new Dexie reads.
 *
 * Pure, no Dexie/network — same convention as `progressReport.ts`/
 * `stepUsefulness.ts`. Called directly from `ProgressPage` with the
 * `WeekBucket[]` it already fetched via `getProgressReport`, so there is no
 * `repository.ts#getVelocity` wrapper.
 */

export interface VelocityReport {
  backlogSize: number;
  /**
   * Average words newly recalled per week, over complete weeks only — the
   * most recent bucket is the current, still-in-progress week and would
   * understate the rate if included.
   */
  weeklyWordsLearnedRate: number | null;
  /** `null` when the rate is 0 or there's no complete week of data yet — "no ETA" rather than infinity. */
  weeksToClearBacklog: number | null;
}

export function buildVelocityReport(backlogSize: number, weeks: WeekBucket[]): VelocityReport {
  const completeWeeks = weeks.slice(0, -1);
  const weeklyWordsLearnedRate =
    completeWeeks.length > 0
      ? completeWeeks.reduce((sum, week) => sum + week.wordsLearned, 0) / completeWeeks.length
      : null;
  const weeksToClearBacklog =
    weeklyWordsLearnedRate && weeklyWordsLearnedRate > 0
      ? Math.ceil(backlogSize / weeklyWordsLearnedRate)
      : null;
  return { backlogSize, weeklyWordsLearnedRate, weeksToClearBacklog };
}
