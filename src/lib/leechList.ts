import { metaFor } from './errorMix';

/**
 * "Leech list" (docs/ROADMAP.md "Possibilities") — rank study items by FSRS
 * `lapses` plus the session planner's own `weakness` term
 * (`recentAgainCount / recentReviewCount`, `sessionPlanner.ts#scoreReviewPriority`),
 * show the `errorClassification` reason behind the misses, and point at a
 * real intervention (reusing `errorMix.ts#metaFor`'s label/next-action/route
 * table so the two views never disagree on what a classification means).
 * Deliberately never a standalone leech drill — the point is surfacing which
 * *specific* items are struggling and why, not another queue to grind.
 *
 * A "leech" here requires `lapses > 0` (a real forgetting event FSRS has
 * already recorded), not just a low recent pass rate on a still-new item —
 * same distinction sessionPlanner.ts's `weakness` term explicitly does NOT
 * make (a brand-new item defaults to a nonzero weakness so it still competes
 * for a review slot); this list is stricter on purpose, since its whole
 * point is "past forgetting," not "still learning."
 *
 * Pure, no Dexie/network — same convention as `errorMix.ts`/
 * `progressReport.ts`. `src/db/repository.ts#getLeechList` does the only
 * fetching.
 */

export interface LeechCandidateInput {
  studyItemId: string;
  subjectLabel: string;
  activityType: string;
  lapses: number;
  /** Out of the last few reviews of this study item, how many were "again" — same window `sessionPlanner.ts` uses. */
  recentAgainCount: number;
  recentReviewCount: number;
  /** Most common `errorClassification` key among this item's recent misses, or null if none classified. */
  topErrorClassificationKey: string | null;
}

export interface LeechRow {
  studyItemId: string;
  subjectLabel: string;
  activityType: string;
  lapses: number;
  weakness: number;
  score: number;
  reasonLabel: string;
  nextAction: string;
  route?: string;
}

export interface LeechListReport {
  hasData: boolean;
  rows: LeechRow[];
}

const DEFAULT_LIMIT = 10;

export function buildLeechList(
  inputs: readonly LeechCandidateInput[],
  limit: number = DEFAULT_LIMIT,
): LeechListReport {
  const rows: LeechRow[] = inputs
    .filter((input) => input.lapses > 0)
    .map((input) => {
      const weakness =
        input.recentReviewCount > 0 ? input.recentAgainCount / input.recentReviewCount : 0;
      const meta = input.topErrorClassificationKey
        ? metaFor(input.topErrorClassificationKey)
        : { label: 'No classified reason yet', nextAction: 'Review these' };
      return {
        studyItemId: input.studyItemId,
        subjectLabel: input.subjectLabel,
        activityType: input.activityType,
        lapses: input.lapses,
        weakness,
        score: input.lapses + weakness,
        reasonLabel: meta.label,
        nextAction: meta.nextAction,
        route: meta.route,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return { hasData: rows.length > 0, rows };
}
