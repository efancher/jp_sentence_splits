import type { EffectiveGameSignal, FsrsState, GameSignal } from '../domain/types';
import { MATURE_MIN_SCHEDULED_DAYS } from './maturity';
import { predictRetrievability } from './scheduling';
import { seededShuffle } from './seededShuffle';

/**
 * Item picker shared by every short game (`/play`, docs/ROADMAP.md "Short
 * games"). A game hands it the candidates that already passed its own
 * `eligible()` check — eligibility is applied *before* ranking, so an item
 * that can never be played can't starve a signal (the per-item-gate lesson,
 * 2026-09-16) — and a signal saying what the round should aim at:
 *
 *   weak   — words that have lapsed (a real FSRS forgetting event, the same
 *            bar `leechList.ts` uses), worst first;
 *   stale  — words whose predicted recall has decayed the most;
 *   strong — solid, long-interval words, for a confidence round.
 *
 * Read-only over FSRS state: nothing here (or in any game) writes a review.
 * Pure — the repository builds `PickerStats` from Dexie.
 */
export interface PickerStats {
  /** At least one card has been reviewed at least once (a `new`-state card carries no signal). */
  hasCard: boolean;
  /** Total lapses across the item's reviewed cards. */
  lapses: number;
  /** The *lowest* predicted recall across its reviewed cards; null when `!hasCard`. */
  retrievability: number | null;
  /** Every reviewed card is in the stable `review` state with a long interval. */
  matureCards: boolean;
}

export interface PickerCandidate {
  id: string;
  stats: PickerStats;
}

export const GAME_SIGNALS: readonly GameSignal[] = ['weak', 'stale', 'strong'];

export const SIGNAL_LABELS: Record<GameSignal, string> = {
  weak: 'Weak spots',
  stale: 'Fading',
  strong: 'Confidence',
};

export const SIGNAL_BLURBS: Record<GameSignal, string> = {
  weak: "Words you've forgotten before — the ones that keep slipping.",
  stale: 'Words whose recall has decayed the most since you last saw them.',
  strong: 'Words you know solidly — a low-pressure round to enjoy.',
};

/** Below this predicted recall a word counts as "fading". */
export const STALE_MAX_RETRIEVABILITY = 0.85;
/** At or above this predicted recall (with mature cards) a word counts as solid. */
export const STRONG_MIN_RETRIEVABILITY = 0.9;
/** A round samples from the top `n * POOL_SLICE_FACTOR` ranked items so it isn't the same set every time. */
const POOL_SLICE_FACTOR = 3;

/** Collapse an item's study cards (all activity types) into the picker's view of it. */
export function summarizeCardStats(states: readonly FsrsState[], now: Date = new Date()): PickerStats {
  // `state === 'new'` cards were seeded but never reviewed; a non-new card
  // missing `lastReview` is legacy/malformed and ts-fsrs's retrievability
  // throws on it (same guard as getFsrsConfidenceSnapshot).
  const reviewed = states.filter((state) => state.state !== 'new' && state.lastReview);
  if (reviewed.length === 0) {
    return { hasCard: false, lapses: 0, retrievability: null, matureCards: false };
  }
  return {
    hasCard: true,
    lapses: reviewed.reduce((sum, state) => sum + state.lapses, 0),
    retrievability: Math.min(...reviewed.map((state) => predictRetrievability(state, now))),
    matureCards: reviewed.every(
      (state) => state.state === 'review' && state.scheduledDays >= MATURE_MIN_SCHEDULED_DAYS,
    ),
  };
}

export function isInSignalPool(stats: PickerStats, signal: GameSignal): boolean {
  switch (signal) {
    case 'weak':
      return stats.lapses > 0;
    case 'stale':
      return (
        stats.hasCard &&
        stats.retrievability !== null &&
        stats.retrievability < STALE_MAX_RETRIEVABILITY
      );
    case 'strong':
      return (
        stats.hasCard &&
        stats.matureCards &&
        stats.retrievability !== null &&
        stats.retrievability >= STRONG_MIN_RETRIEVABILITY
      );
  }
}

function rank<T extends PickerCandidate>(pool: T[], signal: GameSignal): T[] {
  const recall = (candidate: T) => candidate.stats.retrievability ?? 1;
  return [...pool].sort((a, b) => {
    if (signal === 'weak') {
      return b.stats.lapses - a.stats.lapses || recall(a) - recall(b);
    }
    if (signal === 'stale') return recall(a) - recall(b);
    return recall(b) - recall(a);
  });
}

export function signalPoolSizes(
  candidates: readonly PickerCandidate[],
): Record<GameSignal, number> {
  const sizes: Record<GameSignal, number> = { weak: 0, stale: 0, strong: 0 };
  for (const candidate of candidates) {
    for (const signal of GAME_SIGNALS) {
      if (isInSignalPool(candidate.stats, signal)) sizes[signal] += 1;
    }
  }
  return sizes;
}

export interface PickResult<T extends PickerCandidate> {
  items: T[];
  /** The signal actually used — may differ from the one requested. */
  signal: EffectiveGameSignal;
  /** Items eligible for `signal` (before sampling). */
  poolSize: number;
  requested: GameSignal;
  /** True when `requested` didn't have enough items and another signal (or `any`) was used. */
  fellBack: boolean;
}

/**
 * Pick `n` items for `requested`, falling back weak → stale → strong → any
 * when its pool is smaller than `n` (an empty round is never returned while
 * any eligible candidate exists). Order within a signal is deterministic; the
 * round's variety comes from sampling a shuffled top slice with `seed`.
 */
export function pickItems<T extends PickerCandidate>(
  candidates: readonly T[],
  options: { signal: GameSignal; n: number; seed: string },
): PickResult<T> {
  const { signal: requested, n, seed } = options;
  const order: GameSignal[] = [requested, ...GAME_SIGNALS.filter((s) => s !== requested)];

  const take = (pool: T[], signal: EffectiveGameSignal): PickResult<T> => {
    // A real signal samples its top-ranked slice; the `any` fallback has no
    // ranking worth honouring, so it samples the whole pool (otherwise every
    // fallback round would re-draw the same first few items).
    const slice = signal === 'any' ? pool : pool.slice(0, Math.max(n, n * POOL_SLICE_FACTOR));
    return {
      items: seededShuffle(slice, (item) => item.id, seed).slice(0, n),
      signal,
      poolSize: pool.length,
      requested,
      fellBack: signal !== requested,
    };
  };

  for (const signal of order) {
    const pool = candidates.filter((candidate) => isInSignalPool(candidate.stats, signal));
    if (pool.length >= n) return take(rank(pool, signal), signal);
  }
  // Last resort: any eligible candidate.
  return take([...candidates], 'any');
}

/** One-line "why this item" for the result screen. */
export function describePick(signal: EffectiveGameSignal, stats: PickerStats): string {
  const pct =
    stats.retrievability === null ? null : Math.round(stats.retrievability * 100);
  switch (signal) {
    case 'weak':
      return `Lapsed ${stats.lapses}× in review.`;
    case 'stale':
      return pct === null ? 'Fading from memory.' : `Predicted recall ~${pct}%.`;
    case 'strong':
      return pct === null ? 'A solid word.' : `A solid word (predicted recall ~${pct}%).`;
    case 'any':
      return stats.hasCard ? 'From your confirmed vocabulary.' : "Confirmed, but you haven't reviewed it yet.";
  }
}

/**
 * Wording that differs per game. The defaults describe vocabulary (Word
 * Detective); a game whose items aren't words (Particle Puzzle) passes its own.
 */
export interface SignalCopy {
  /** Completes "…this round draws from ___." when even `any` was needed. */
  anyPool: string;
  blurbs: Record<GameSignal, string>;
}

export const DEFAULT_SIGNAL_COPY: SignalCopy = {
  anyPool: 'your confirmed vocabulary',
  blurbs: SIGNAL_BLURBS,
};

/** The line above a round explaining what it's aimed at, incl. an honest note when it fell back. */
export function describeRound(
  result: Pick<PickResult<PickerCandidate>, 'signal' | 'requested' | 'fellBack' | 'poolSize'>,
  copy: SignalCopy = DEFAULT_SIGNAL_COPY,
): string {
  if (result.signal === 'any') {
    return `Not enough material for “${SIGNAL_LABELS[result.requested]}” yet, so this round draws from ${copy.anyPool}.`;
  }
  const base = copy.blurbs[result.signal];
  return result.fellBack
    ? `Not enough material for “${SIGNAL_LABELS[result.requested]}” yet — playing “${SIGNAL_LABELS[result.signal]}” instead. ${base}`
    : base;
}
