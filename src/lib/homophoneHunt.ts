import type { EffectiveGameSignal, GameRound } from '../domain/types';
import type { PickerCandidate, PickerStats, SignalCopy } from './gamePicker';
import {
  buildMinimalPairTrials,
  type MinimalPairContrast,
  type MinimalPairOccurrence,
  type MinimalPairTrial,
} from './pitchAccentMinimalPairs';

/**
 * Homophone Hunt (docs/ROADMAP.md "Short games", 2026-09-26 brainstorm): the
 * existing same/different ABX near-minimal-pair warm-up
 * (`PitchAccentMinimalPairWarmup`, ungraded, buried inside the pitch-accent
 * drill) promoted to its own scored round under `/play`. Two words share a
 * reading but not a pitch-accent position (箸 atamadaka vs 橋 heiban/odaka) —
 * hear both real clips, pick which is which, see the measured contours on
 * reveal. One point per correct guess.
 *
 * True homophones with a pitch contrast are rare in any one learner's
 * vocabulary (see `PitchAccentMinimalPairWarmup`'s own "no pairs available"
 * copy), so this game leans on `buildMinimalPairTrials`'s per-contrast
 * same-book + cross-book pairing to stretch a thin corpus into a short round
 * rather than requiring many distinct contrasts.
 *
 * Pure: the repository hands in occurrences and `gameRounds` history.
 */
export const HOMOPHONE_HUNT_GAME_ID = 'homophone-hunt';
/** Trials per round — matches `buildMinimalPairTrials`'s own per-contrast cap (same-book + cross-book). */
export const HOMOPHONE_HUNT_ROUND_SIZE = 5;
/** Fewer than this and the hub hides the game. */
export const HOMOPHONE_HUNT_MIN_TRIALS = 2;
/** A correct guess is worth this many points; a wrong one, none — there's only one alternative to pick. */
export const HOMOPHONE_TRIAL_POINTS = 1;
export const HOMOPHONE_HISTORY_ROUNDS = 60;

export const HOMOPHONE_HUNT_COPY: SignalCopy = {
  anyPool: 'homophone pairs among your own words',
  blurbs: {
    weak: "Pairs you've mixed up before.",
    stale: "Pairs it's been a while since you last heard.",
    strong: "Pairs you've been telling apart reliably — a relaxed round.",
  },
};

/** Stable id for a word pair, order-independent. */
export function contrastPairKey(contrast: Pick<MinimalPairContrast, 'a' | 'b'>): string {
  return [contrast.a.vocabularyItemId, contrast.b.vocabularyItemId].sort().join('/');
}

/**
 * Stable per-trial key: `MinimalPairTrial` (unlike `OddEarTrial`) carries no
 * `id` of its own — a pair's key plus which speaker variant (same-book vs
 * cross-book, `buildMinimalPairTrials`'s own distinction) is unique within a round.
 */
export function trialKey(trial: Pick<MinimalPairTrial<MinimalPairOccurrence>, 'a' | 'b' | 'sameBook'>): string {
  return `${contrastPairKey({ a: trial.a, b: trial.b })}:${trial.sameBook ? 'same' : 'cross'}`;
}

export interface HomophoneHistoryEntry {
  attempts: number;
  misses: number;
}

/** Per word-pair attempts/misses over the most recent Homophone Hunt rounds. */
export function buildHomophoneHistory(
  rounds: readonly Pick<GameRound, 'timestamp' | 'items'>[],
  limit: number = HOMOPHONE_HISTORY_ROUNDS,
): Map<string, HomophoneHistoryEntry> {
  const history = new Map<string, HomophoneHistoryEntry>();
  const recent = [...rounds].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
  for (const round of recent) {
    for (const item of round.items) {
      for (const part of item.parts ?? []) {
        const entry = history.get(part.key) ?? { attempts: 0, misses: 0 };
        entry.attempts += 1;
        if (!part.correct) entry.misses += 1;
        history.set(part.key, entry);
      }
    }
  }
  return history;
}

/** Attempts on a pair before it can count as a "strong" contrast. */
const MATURE_ATTEMPTS = 4;

/**
 * Map a pair's history onto the shared picker's `PickerStats` — same reading
 * as Odd Ear Out's `contrastStats`: `lapses` = recent misses,
 * `retrievability` = recent accuracy, `matureCards` = enough attempts to
 * trust it.
 */
export function contrastStats(
  contrast: MinimalPairContrast,
  history: ReadonlyMap<string, HomophoneHistoryEntry>,
): PickerStats {
  const entry = history.get(contrastPairKey(contrast));
  if (!entry || entry.attempts === 0) {
    return { hasCard: false, lapses: 0, retrievability: null, matureCards: false };
  }
  return {
    hasCard: true,
    lapses: entry.misses,
    retrievability: 1 - entry.misses / entry.attempts,
    matureCards: entry.attempts >= MATURE_ATTEMPTS,
  };
}

export interface HomophoneCandidate extends PickerCandidate {
  contrast: MinimalPairContrast;
}

export function buildHomophoneCandidates(
  contrasts: readonly MinimalPairContrast[],
  history: ReadonlyMap<string, HomophoneHistoryEntry>,
): HomophoneCandidate[] {
  return contrasts.map((contrast) => ({
    id: contrastPairKey(contrast),
    contrast,
    stats: contrastStats(contrast, history),
  }));
}

/** One-line "why this pair" for the result screen. */
export function describeHomophonePick(
  signal: EffectiveGameSignal,
  contrast: MinimalPairContrast,
  history: ReadonlyMap<string, HomophoneHistoryEntry>,
): string {
  const missed = history.get(contrastPairKey(contrast))?.misses ?? 0;
  if (signal === 'weak' && missed > 0) {
    return `You've mixed up this pair before (${missed} miss${missed === 1 ? '' : 'es'}).`;
  }
  if (signal === 'strong') return "A pair you've been telling apart reliably.";
  return `A true homophone pair — both read ${contrast.reading}.`;
}

/**
 * Fill a round from `order` (the picker's ranked contrasts first, then the
 * rest, already shuffled by the caller for variety across "Play again"):
 * thin wrapper over `buildMinimalPairTrials` so the game only depends on
 * this module, not the warm-up's own.
 */
export function buildHomophoneRound<T extends MinimalPairOccurrence>(
  occurrences: readonly T[],
  order: readonly MinimalPairContrast[],
  size: number = HOMOPHONE_HUNT_ROUND_SIZE,
): MinimalPairTrial<T>[] {
  return buildMinimalPairTrials([...order], [...occurrences], size);
}
