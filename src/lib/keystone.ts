import type { PickerCandidate } from './gamePicker';
import { seededShuffle } from './seededShuffle';

/**
 * Keystone (docs/ROADMAP.md "Short games"): a front door to the no-card
 * backlog — confirmed vocabulary with no study item yet (the same words
 * `countNewVocabularyCardBacklog` counts), scoped to ones that actually
 * appear in the next unstarted sentences of an active book. Each puzzle
 * shows a few backlog words and asks which one unlocks the most upcoming
 * reading (appears in the most of those sentences); the reveal shows the
 * real counts and an example sentence for each. Nothing here is FSRS-backed
 * or scored against a signal — a backlog word by definition has no card yet,
 * so `weak`/`stale`/`strong` never apply (`getKeystoneCandidates` gives every
 * candidate `stats: { hasCard: false, ... }`, same honest reading
 * `particlePuzzle.ts` uses for a game with no FSRS history). The round's own
 * ranking (unlock count) stands in for the picker's signal ranking instead of
 * going through `pickItems`.
 */
export const KEYSTONE_GAME_ID = 'keystone';
export const KEYSTONE_ROUND_SIZE = 5;
export const KEYSTONE_CHOICE_COUNT = 4;
/** Sample targets from the top slice of ranked candidates so a round favors genuinely high-impact words without drawing the same set every time. */
const POOL_SLICE_FACTOR = 3;

export interface KeystoneCandidate extends PickerCandidate {
  item: { id: string; expression: string; reading: string; meaning: string };
  /** Upcoming sentence ids this word appears in — the "unlock" count is its length. */
  unlockedSentenceIds: readonly string[];
  exampleSentence: { id: string; japanese: string; translation?: string };
}

export interface KeystonePuzzle {
  choices: readonly KeystoneCandidate[];
  answerVocabularyItemId: string;
}

export interface KeystoneRound {
  puzzles: KeystonePuzzle[];
  poolSize: number;
}

/** The choice within a puzzle with the most upcoming occurrences (ties broken by id, deterministic). */
function bestChoice(choices: readonly KeystoneCandidate[]): KeystoneCandidate {
  return choices.reduce((best, choice) =>
    choice.unlockedSentenceIds.length > best.unlockedSentenceIds.length ||
    (choice.unlockedSentenceIds.length === best.unlockedSentenceIds.length &&
      choice.id.localeCompare(best.id) < 0)
      ? choice
      : best,
  );
}

function buildKeystonePuzzle(
  target: KeystoneCandidate,
  pool: readonly KeystoneCandidate[],
  seed: string,
): KeystonePuzzle {
  const targetCount = target.unlockedSentenceIds.length;
  const lower = pool.filter(
    (c) => c.id !== target.id && c.unlockedSentenceIds.length < targetCount,
  );
  const rest = pool.filter(
    (c) => c.id !== target.id && c.unlockedSentenceIds.length >= targetCount,
  );
  const decoyCount = KEYSTONE_CHOICE_COUNT - 1;
  const decoyPool = lower.length >= decoyCount ? lower : [...lower, ...rest];
  const decoys = seededShuffle(decoyPool, (c) => c.id, `${seed}:decoys`).slice(0, decoyCount);
  const choices = seededShuffle([target, ...decoys], (c) => c.id, `${seed}:order`);
  return { choices, answerVocabularyItemId: bestChoice(choices).id };
}

/**
 * Builds a round of `n` puzzles. Targets are sampled from the top
 * `n * POOL_SLICE_FACTOR` ranked-by-unlock-count candidates (mirrors
 * `pickItems`'s slice-then-shuffle shape) so the round leans toward
 * genuinely high-impact words without being the identical set every replay.
 */
export function buildKeystoneRound(
  candidates: readonly KeystoneCandidate[],
  n: number,
  seed: string,
): KeystoneRound {
  const poolSize = candidates.length;
  const ranked = [...candidates].sort(
    (a, b) =>
      b.unlockedSentenceIds.length - a.unlockedSentenceIds.length || a.id.localeCompare(b.id),
  );
  const slice = ranked.slice(0, Math.max(n, n * POOL_SLICE_FACTOR));
  const targets = seededShuffle(slice, (c) => c.id, seed).slice(0, n);
  const puzzles = targets.map((target, index) =>
    buildKeystonePuzzle(target, candidates, `${seed}:${index}`),
  );
  return { puzzles, poolSize };
}

/** One-line "why this word" for the result screen. */
export function describeKeystonePick(candidate: KeystoneCandidate): string {
  const count = candidate.unlockedSentenceIds.length;
  return `Appears in ${count} upcoming sentence${count === 1 ? '' : 's'} you haven't read yet.`;
}
