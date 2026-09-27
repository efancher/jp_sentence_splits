import type { EffectiveGameSignal, GameRound } from '../domain/types';
import type { PickerCandidate, PickerStats, SignalCopy } from './gamePicker';

/**
 * Speaker Match (docs/ROADMAP.md "Short games", 2026-09-26 brainstorm):
 * gamifies the "Compare speakers" browse tool (`/pitch-accent/compare`,
 * `getPitchAccentSpeakerComparisons`) — the same confirmed, citation-form
 * word mined out of 2+ distinct books, each book standing in for a
 * different speaker (a book is normally one show/narrator, not verified
 * per-clip identity — same proxy `getPitchAccentMinimalPairOccurrences`
 * documents).
 *
 * The roadmap's original framing ("guess which matches a shown dictionary
 * shape") doesn't actually have a wrong answer to detect: two real clips of
 * the same, correctly-pronounced word both match the dictionary shape.
 * Built instead as the roadmap's own parenthetical alternative — "which is
 * which" — a pure cross-recording discrimination task: hear both clips of
 * the *same* word, one book named as the target, guess which clip is that
 * book's. Reuses Homophone Hunt's ABX shape (`TrialView`-style two-clip
 * pick, measured-contour reveal) with a same-word/different-book pair in
 * place of a different-word/same-reading one.
 *
 * v1 fixes the pair per word at its two alphabetically-first book titles
 * (stable across sessions, matching how `getPitchAccentSpeakerComparisons`
 * already sorts `clips`) rather than rotating through every book pair a
 * 3+-book word could offer — a real widening if the corpus grows enough to
 * want it, not attempted here.
 *
 * Pure: the repository hands in comparisons already resolved from Dexie
 * plus `gameRounds` history.
 */
export const SPEAKER_MATCH_GAME_ID = 'speaker-match';
/** Trials per round — same "short round from a thin corpus" reasoning as Homophone Hunt. */
export const SPEAKER_MATCH_ROUND_SIZE = 5;
/** Fewer than this and the hub hides the game. */
export const SPEAKER_MATCH_MIN_TRIALS = 2;
/** A correct guess is worth this many points; a wrong one, none. */
export const SPEAKER_MATCH_TRIAL_POINTS = 1;
export const SPEAKER_MATCH_HISTORY_ROUNDS = 60;

export const SPEAKER_MATCH_COPY: SignalCopy = {
  anyPool: 'words you have clips of from more than one book',
  blurbs: {
    weak: "Words whose recordings you've mixed up before.",
    stale: "Words it's been a while since you compared.",
    strong: "Words you've been telling recordings apart reliably — a relaxed round.",
  },
};

export interface SpeakerMatchWordSummary {
  vocabularyItemId: string;
  expression: string;
  reading: string;
  meaning: string;
  position: number;
}

export interface SpeakerMatchOccurrence {
  bookId: string;
  bookTitle: string;
}

export interface SpeakerMatchComparison<TOccurrence extends SpeakerMatchOccurrence> {
  word: SpeakerMatchWordSummary;
  /** Sorted by `bookTitle`, one per book — mirrors `getPitchAccentSpeakerComparisons`. */
  clips: readonly TOccurrence[];
}

export interface SpeakerMatchTrial<TOccurrence extends SpeakerMatchOccurrence> {
  word: SpeakerMatchWordSummary;
  a: TOccurrence;
  b: TOccurrence;
}

/** Stable key for a word's fixed clip pair — just the word, since v1 fixes the pair. */
export function speakerMatchKey(word: Pick<SpeakerMatchWordSummary, 'vocabularyItemId'>): string {
  return word.vocabularyItemId;
}

export interface SpeakerMatchHistoryEntry {
  attempts: number;
  misses: number;
}

/** Per-word attempts/misses over the most recent Speaker Match rounds. */
export function buildSpeakerMatchHistory(
  rounds: readonly Pick<GameRound, 'timestamp' | 'items'>[],
  limit: number = SPEAKER_MATCH_HISTORY_ROUNDS,
): Map<string, SpeakerMatchHistoryEntry> {
  const history = new Map<string, SpeakerMatchHistoryEntry>();
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

/** Attempts on a word before it can count as a "strong" pair. */
const MATURE_ATTEMPTS = 4;

/** Map a word's history onto the shared picker's `PickerStats` — same reading as Homophone Hunt's `contrastStats`. */
export function speakerMatchStats(
  word: Pick<SpeakerMatchWordSummary, 'vocabularyItemId'>,
  history: ReadonlyMap<string, SpeakerMatchHistoryEntry>,
): PickerStats {
  const entry = history.get(speakerMatchKey(word));
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

export interface SpeakerMatchCandidate<TOccurrence extends SpeakerMatchOccurrence> extends PickerCandidate {
  comparison: SpeakerMatchComparison<TOccurrence>;
}

export function buildSpeakerMatchCandidates<TOccurrence extends SpeakerMatchOccurrence>(
  comparisons: readonly SpeakerMatchComparison<TOccurrence>[],
  history: ReadonlyMap<string, SpeakerMatchHistoryEntry>,
): SpeakerMatchCandidate<TOccurrence>[] {
  return comparisons
    .filter((comparison) => comparison.clips.length >= 2)
    .map((comparison) => ({
      id: speakerMatchKey(comparison.word),
      comparison,
      stats: speakerMatchStats(comparison.word, history),
    }));
}

/** One-line "why this word" for the result screen. */
export function describeSpeakerMatchPick(
  signal: EffectiveGameSignal,
  word: SpeakerMatchWordSummary,
  history: ReadonlyMap<string, SpeakerMatchHistoryEntry>,
): string {
  const missed = history.get(speakerMatchKey(word))?.misses ?? 0;
  if (signal === 'weak' && missed > 0) {
    return `You've mixed up these recordings before (${missed} miss${missed === 1 ? '' : 'es'}).`;
  }
  if (signal === 'strong') return "A pair of recordings you've been telling apart reliably.";
  return `${word.expression} (${word.reading}), mined from more than one book.`;
}

/** Up to `size` trials, one per candidate in `order` — the fixed two-clip pair each word already carries. */
export function buildSpeakerMatchRound<TOccurrence extends SpeakerMatchOccurrence>(
  order: readonly SpeakerMatchComparison<TOccurrence>[],
  size: number = SPEAKER_MATCH_ROUND_SIZE,
): SpeakerMatchTrial<TOccurrence>[] {
  const trials: SpeakerMatchTrial<TOccurrence>[] = [];
  for (const comparison of order) {
    if (trials.length >= size) break;
    const [a, b] = comparison.clips;
    if (!a || !b) continue;
    trials.push({ word: comparison.word, a, b });
  }
  return trials;
}
