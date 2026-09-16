/**
 * "FSRS confidence snapshot" (docs/ROADMAP.md — "FSRS calibration
 * surfacing"). Buckets the *current* predicted retrievability
 * (`scheduling.ts#predictRetrievability`) of every active study item —
 * how likely FSRS thinks you are to recall each one right now, not at
 * some future due date. A pile of items in the low buckets means reviews
 * are lagging behind schedule; everything crowded into the top bucket
 * means the opposite (reviewing more than the schedule actually needs).
 *
 * Deliberately not "predicted vs. actual pass rate at review time" — that
 * needs the predicted retrievability logged on each `Review` row at the
 * moment it was graded, which nothing does today (see docs/ROADMAP.md).
 * This is the honest subset of that idea buildable from state already on
 * `StudyItem` with no new logging: a live snapshot, not a retrospective
 * validation.
 *
 * Pure, no Dexie/network — same convention as `progressReport.ts`.
 * `src/db/repository.ts#getFsrsConfidenceSnapshot` does the only fetching.
 */

export interface RetrievabilityBucket {
  /** Inclusive lower bound, e.g. 0.9 for "90-100%". */
  min: number;
  label: string;
  count: number;
}

export interface FsrsConfidenceSnapshot {
  hasData: boolean;
  /** Active (learning/review/relearning) study items with a computable retrievability. */
  activeCount: number;
  averageRetrievability: number | null;
  buckets: RetrievabilityBucket[];
}

const BUCKET_BOUNDS = [0.95, 0.85, 0.7, 0.5, 0] as const;

function bucketLabel(min: number, index: number): string {
  if (index === 0) return `${Math.round(min * 100)}%+`;
  const max = BUCKET_BOUNDS[index - 1]!;
  return `${Math.round(min * 100)}–${Math.round(max * 100)}%`;
}

export function buildFsrsConfidenceSnapshot(retrievabilities: number[]): FsrsConfidenceSnapshot {
  const buckets: RetrievabilityBucket[] = BUCKET_BOUNDS.map((min, index) => ({
    min,
    label: bucketLabel(min, index),
    count: 0,
  }));
  for (const r of retrievabilities) {
    const bucket = buckets.find((b) => r >= b.min);
    if (bucket) bucket.count += 1;
  }
  const total = retrievabilities.length;
  return {
    hasData: total > 0,
    activeCount: total,
    averageRetrievability:
      total > 0 ? retrievabilities.reduce((sum, r) => sum + r, 0) / total : null,
    buckets,
  };
}
