/**
 * The daily top-up of never-introduced vocabulary words (`settings.dailyNewWordQuota`).
 *
 * Review used to introduce a new word only once the due queue ran dry, so on a
 * heavy review day none arrived while confirmations kept piling up (2026-09-21:
 * 232 words confirmed in a week, 22 seeded). The top-up seeds a fixed number
 * each local day when Review opens, regardless of the queue.
 */

/** A pending (descriptor, subject) seed, as ReviewPage's pool holds them. */
export interface PoolSeed {
  descriptorKey: string;
  subjectId: string;
}

/** The descriptor whose subjects are vocabulary words. */
export const VOCABULARY_DESCRIPTOR_KEY = 'vocabulary';

/**
 * The next `remaining` distinct vocabulary subjects in pool order — the pool is
 * already interleaved and sibling-spaced, so its order is the order to
 * introduce them in. Returns nothing for a non-positive `remaining`.
 */
export function pickQuotaSubjects(pool: readonly PoolSeed[], remaining: number): string[] {
  if (!(remaining > 0)) return [];
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const seed of pool) {
    if (seed.descriptorKey !== VOCABULARY_DESCRIPTOR_KEY || seen.has(seed.subjectId)) continue;
    seen.add(seed.subjectId);
    picked.push(seed.subjectId);
    if (picked.length >= remaining) break;
  }
  return picked;
}

/** How many words the top-up may still add today. */
export function quotaRemaining(quota: number, seededToday: number): number {
  return Math.max(0, Math.floor(quota) - seededToday);
}
