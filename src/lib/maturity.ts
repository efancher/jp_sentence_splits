/**
 * Context-diversity and maturity heuristics (docs/STATUS.md, Phase 7.1;
 * design brief §8/§13). Pure functions over already-fetched data — no Dexie
 * coupling — so a future review planner and a future debug view can both
 * call these without duplicating the ladder logic, and so they're trivially
 * unit-testable.
 *
 * Diversity counting is scoped to what the schema can actually answer today:
 * a sentence's "source" is the sourceKey (falling back to id) of any Book it
 * belongs to, since Sentence has no direct sourceId yet (the `sources`
 * table exists — docs/UNIFIED_APP_ARCHITECTURE.md §8 — but nothing links a
 * Sentence to it yet). Revisit this once that link exists.
 */

export interface ContextDiversity {
  distinctSentenceCount: number;
  distinctSourceCount: number;
}

/**
 * `sourceKeysBySentenceId` maps each distinct sentence a vocabulary item
 * occurs in to the source keys of the books containing it (a sentence can
 * appear in more than one book, and a book with no sourceKey contributes
 * its own id as a stand-in "source").
 */
export function computeContextDiversity(
  sourceKeysBySentenceId: Map<string, string[]>,
): ContextDiversity {
  const distinctSources = new Set<string>();
  for (const sourceKeys of sourceKeysBySentenceId.values()) {
    for (const key of sourceKeys) distinctSources.add(key);
  }
  return {
    distinctSentenceCount: sourceKeysBySentenceId.size,
    distinctSourceCount: distinctSources.size,
  };
}

/**
 * Small number of interpretable levels (brief §8/§13 explicitly warns
 * against over-engineered precise percentages). Thresholds below are a
 * starting heuristic, not derived from any model — easy to retune once
 * there's real usage data, since every caller goes through this one
 * function rather than re-deriving the ladder.
 */
export type MaturityLevel = 'fragile' | 'established' | 'generalized' | 'mature';

/** FSRS scheduled-interval length (days) treated as "a long interval" for brief §8's "mature" tier. */
export const MATURE_MIN_SCHEDULED_DAYS = 21;

export function computeMaturityLevel(
  diversity: ContextDiversity,
  evidence: { hasLongIntervalSuccess: boolean },
): MaturityLevel {
  if (diversity.distinctSourceCount >= 2 && evidence.hasLongIntervalSuccess) {
    return 'mature';
  }
  if (diversity.distinctSourceCount >= 2) {
    return 'generalized';
  }
  if (diversity.distinctSentenceCount >= 2) {
    return 'established';
  }
  return 'fragile';
}
