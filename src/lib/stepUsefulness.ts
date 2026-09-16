/**
 * "Step usefulness" (2026-09-16 discussion — longitudinal companion to
 * `sessionRecap.ts`'s same-day recap). `PlannerSessionStep.status` already
 * records completed vs. skipped per step; nothing before this rolled that
 * up across sessions by `targetKind`, so there was no way to see "which
 * step kinds actually get done vs. quietly skipped every time" without a
 * one-off script — the same kind of question that already justified
 * retiring the 4-card grammar ladder and the pitch drill's predict step,
 * but available on demand here instead of by gut feel.
 *
 * Pure, no Dexie/network — same convention as `progressReport.ts`.
 * `src/db/repository.ts#getStepUsefulness` does the only fetching
 * (flattens every `PlannerSession.steps` in the window, tagged with the
 * owning session's `date`).
 */

export interface StepUsefulnessInput {
  targetKind: string;
  /** Only 'completed'/'skipped' count — 'pending'/'active'/'replaced' haven't been decided by the learner yet. */
  status: 'pending' | 'active' | 'completed' | 'skipped' | 'replaced';
}

export interface StepUsefulnessRow {
  targetKind: string;
  completed: number;
  skipped: number;
  /** Excludes still-pending steps from the denominator — those haven't been decided yet. */
  total: number;
  skipRate: number | null;
}

export interface StepUsefulnessReport {
  hasData: boolean;
  windowDays: number;
  rows: StepUsefulnessRow[];
}

export function buildStepUsefulness(
  steps: StepUsefulnessInput[],
  windowDays: number,
): StepUsefulnessReport {
  const byKind = new Map<string, { completed: number; skipped: number }>();
  for (const step of steps) {
    if (step.status !== 'completed' && step.status !== 'skipped') continue;
    const entry = byKind.get(step.targetKind) ?? { completed: 0, skipped: 0 };
    if (step.status === 'completed') entry.completed += 1;
    else entry.skipped += 1;
    byKind.set(step.targetKind, entry);
  }
  const rows: StepUsefulnessRow[] = [...byKind.entries()]
    .map(([targetKind, { completed, skipped }]) => {
      const total = completed + skipped;
      return {
        targetKind,
        completed,
        skipped,
        total,
        skipRate: total > 0 ? skipped / total : null,
      };
    })
    .sort((a, b) => (b.skipRate ?? 0) - (a.skipRate ?? 0));
  return { hasData: rows.length > 0, windowDays, rows };
}
