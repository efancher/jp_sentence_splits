import type { Review } from '../domain/types';

// ---------------------------------------------------------------------------
// Sequential episode progression (optional mode). Sentences are introduced in
// episode order (`BookSentence.position`). The next sentence unlocks once at
// least 4 of the previous sentence's last 5 *qualifying* meaning attempts are
// correct. Everything here is derived from review history — no new table —
// and unlocking is latched: once a sentence is accessible it stays accessible.
//
// Qualifying attempt = the learner's first meaning pick on a card, made before
// any hint / translation / explanation was revealed (`Review.meaningChoice
// .qualifying`). Immediate retries after feedback never count. Attempts closer
// than MIN_QUALIFYING_GAP_MS to the previous counted one are also dropped, so
// five attempts means five spaced revisits through the normal review queue,
// not five taps in one sitting.
// ---------------------------------------------------------------------------

export const UNLOCK_WINDOW = 5;
export const UNLOCK_REQUIRED_CORRECT = 4;
export const MIN_QUALIFYING_GAP_MS = 10 * 60 * 1000;

export interface MeaningAttempt {
  timestamp: string;
  correct: boolean;
}

/** Assistance values that mean the answer was reached with help (legacy-record inference). */
const HELPED = new Set(['translation_shown', 'hint_shown', 'chunks_shown', 'mnemonic_shown']);

/**
 * Qualifying attempts from a sentence's review history, oldest first.
 * - New records: use `meaningChoice.qualifying` / `.correct`.
 * - Legacy records (before rotating choices; only `comprehensionCheckCorrect`):
 *   counted when no help was recorded, since the old picker also ran before
 *   the reveal. Reviews with no check result at all never count.
 */
export function qualifyingAttempts(reviews: readonly Review[]): MeaningAttempt[] {
  const sorted = [...reviews].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const out: MeaningAttempt[] = [];
  let lastCounted = Number.NEGATIVE_INFINITY;
  for (const review of sorted) {
    let correct: boolean | undefined;
    if (review.meaningChoice) {
      if (!review.meaningChoice.qualifying) continue;
      correct = review.meaningChoice.correct;
    } else if (review.comprehensionCheckCorrect !== undefined) {
      if ((review.assistance ?? []).some((a) => HELPED.has(a))) continue;
      correct = review.comprehensionCheckCorrect;
    } else {
      continue;
    }
    const at = Date.parse(review.timestamp);
    if (Number.isFinite(at) && at - lastCounted < MIN_QUALIFYING_GAP_MS) continue;
    lastCounted = at;
    out.push({ timestamp: review.timestamp, correct });
  }
  return out;
}

export interface UnlockProgress {
  /** Qualifying attempts counted (capped display uses the last window). */
  attempts: number;
  /** Correct among the last UNLOCK_WINDOW attempts. */
  correctInWindow: number;
  windowSize: number;
  required: number;
  /** Ever satisfied: some window of 5 consecutive attempts had >= 4 correct. Monotonic. */
  cleared: boolean;
  /** Attempts still needed before clearing is even possible (0 once 5 exist). */
  attemptsNeeded: number;
}

export function unlockProgress(attempts: readonly MeaningAttempt[]): UnlockProgress {
  let cleared = false;
  for (let end = UNLOCK_WINDOW; end <= attempts.length && !cleared; end += 1) {
    const correct = attempts.slice(end - UNLOCK_WINDOW, end).filter((a) => a.correct).length;
    if (correct >= UNLOCK_REQUIRED_CORRECT) cleared = true;
  }
  const last = attempts.slice(-UNLOCK_WINDOW);
  return {
    attempts: attempts.length,
    correctInWindow: last.filter((a) => a.correct).length,
    windowSize: UNLOCK_WINDOW,
    required: UNLOCK_REQUIRED_CORRECT,
    cleared,
    attemptsNeeded: Math.max(0, UNLOCK_WINDOW - attempts.length),
  };
}

export type UnlockReason =
  | 'first' // first sentence of the book
  | 'previous_cleared'
  | 'previous_waived' // previous sentence has no usable meaning check and was already worked on, so it cannot gate
  | 'introduced' // already studied before the mode was on (grandfathered)
  | 'latched'; // was unlocked earlier (manual override or earlier computation)

export interface SequentialSentenceStatus {
  sentenceId: string;
  position: number;
  accessible: boolean;
  reason?: UnlockReason;
  /** True when this sentence has no usable meaning check (cannot be cleared, never blocks). */
  waived: boolean;
  progress: UnlockProgress;
  /** The first locked sentence of the book — the one the learner is working toward. */
  isFrontier: boolean;
}

export interface SequentialInputSentence {
  sentenceId: string;
  position: number;
  /** Has a check with at least one usable distractor. */
  hasUsableCheck: boolean;
  /** Reviews for this sentence's reading_in_context item (any order). */
  reviews: readonly Review[];
  /** Already studied before / outside this mode (analysis walkthrough done, reviews exist, …). */
  introduced: boolean;
}

export interface SequentialBookStatus {
  sentences: SequentialSentenceStatus[];
  /** Accessible now but not in `latched` — the caller persists these so unlocks never revert. */
  newlyLatched: string[];
  frontier?: SequentialSentenceStatus;
  /** The sentence whose progress gates the frontier (the one before it). */
  gatingSentence?: SequentialSentenceStatus;
}

/**
 * Per-sentence access for one book, in episode order. `latched` is the set of
 * sentence ids already unlocked earlier (persisted by the caller); anything in
 * it, or already introduced, stays accessible regardless of later data changes.
 */
export function computeSequentialStatus(
  input: readonly SequentialInputSentence[],
  latched: ReadonlySet<string> = new Set(),
): SequentialBookStatus {
  const ordered = [...input].sort((a, b) => a.position - b.position);
  const statuses: SequentialSentenceStatus[] = [];
  const newlyLatched: string[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const s = ordered[i]!;
    const progress = unlockProgress(qualifyingAttempts(s.reviews));
    const waived = !s.hasUsableCheck;
    const prev = statuses[i - 1];
    let reason: UnlockReason | undefined;
    if (latched.has(s.sentenceId)) reason = 'latched';
    else if (s.introduced || progress.attempts > 0) reason = 'introduced';
    else if (i === 0) reason = 'first';
    else if (prev?.accessible) {
      if (prev.progress.cleared) reason = 'previous_cleared';
      else if (prev.waived && ordered[i - 1]!.introduced) reason = 'previous_waived';
    }
    const accessible = reason !== undefined;
    // A waiver unlock is derived, not earned: leave it unlatched so it follows the rule.
    if (accessible && reason !== 'previous_waived' && !latched.has(s.sentenceId)) newlyLatched.push(s.sentenceId);
    statuses.push({
      sentenceId: s.sentenceId,
      position: s.position,
      accessible,
      reason,
      waived,
      progress,
      isFrontier: false,
    });
  }
  const frontierIndex = statuses.findIndex((s) => !s.accessible);
  const frontier = frontierIndex === -1 ? undefined : statuses[frontierIndex];
  if (frontier) frontier.isFrontier = true;
  return {
    sentences: statuses,
    newlyLatched,
    frontier,
    gatingSentence: frontierIndex > 0 ? statuses[frontierIndex - 1] : undefined,
  };
}
