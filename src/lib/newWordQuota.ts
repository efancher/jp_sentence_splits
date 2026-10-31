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
  activityType?: string;
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

/** The descriptor whose subjects are audio-gated sentences (`listening`, `ear_tiles`, `dictation_tile:N`). */
export const AUDIO_DESCRIPTOR_KEY = 'listening';

/**
 * The daily audio top-up (`settings.dailyNewAudioCardQuota`): the same idea as
 * the word top-up, for the Ear Tiles → dictation ladder. The lazy seeding path
 * only runs when the due queue is empty, which it never was (2026-10-21: 74
 * sentence cards due, no `ear_tiles` card ever created, so no dictation).
 * Picks up to `remaining` distinct sentences that still need an `ear_tiles` card.
 */
export function pickAudioQuotaSubjects(pool: readonly PoolSeed[], remaining: number): string[] {
  if (!(remaining > 0)) return [];
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const seed of pool) {
    if (seed.descriptorKey !== AUDIO_DESCRIPTOR_KEY || seed.activityType !== 'ear_tiles') continue;
    if (seen.has(seed.subjectId)) continue;
    seen.add(seed.subjectId);
    picked.push(seed.subjectId);
    if (picked.length >= remaining) break;
  }
  return picked;
}

/** The descriptor whose subjects are sentences' `reading_in_context` cards. */
export const SENTENCE_DESCRIPTOR_KEY = 'sentence';

/**
 * The daily sentence-card top-up (`settings.dailyNewSentenceCardQuota`): the
 * same floor for the first `reading_in_context` card of an introduced sentence.
 * Like the others, lazy seeding never reached them on a busy queue (no new
 * sentence card of any type was created after 2026-10-18 01:09 UTC).
 */
export function pickSentenceQuotaSubjects(pool: readonly PoolSeed[], remaining: number): string[] {
  if (!(remaining > 0)) return [];
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const seed of pool) {
    if (seed.descriptorKey !== SENTENCE_DESCRIPTOR_KEY || seen.has(seed.subjectId)) continue;
    seen.add(seed.subjectId);
    picked.push(seed.subjectId);
    if (picked.length >= remaining) break;
  }
  return picked;
}

/** The descriptor whose subjects are audio-gated sentences' `shadowing` review cards. */
export const SHADOWING_DESCRIPTOR_KEY = 'shadowingCard';

/** New `shadowing` cards seeded per local day (no setting yet; a fixed floor like the other top-ups). */
export const DAILY_NEW_SHADOWING_CARDS = 2;

/**
 * The daily shadowing top-up: the first `shadowing` card of up to `remaining`
 * introduced, audio-bearing sentences, in pool order (already interleaved).
 */
export function pickShadowingQuotaSubjects(pool: readonly PoolSeed[], remaining: number): string[] {
  if (!(remaining > 0)) return [];
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const seed of pool) {
    if (seed.descriptorKey !== SHADOWING_DESCRIPTOR_KEY || seen.has(seed.subjectId)) continue;
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
