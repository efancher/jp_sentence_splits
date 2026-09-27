/**
 * Then & Now (docs/ROADMAP.md "Short games", 2026-09-26 brainstorm): replay
 * a native clip from a sentence read a while ago, with the words that were
 * still unknown back then ducked quiet, then play it again at full volume —
 * a reflective "notice how much clearer this is now" moment, not a scored
 * round (2026-09-27 decision: no right/wrong exists here to grade, so this
 * writes nothing to `gameRounds`/FSRS, unlike every other `/play` activity).
 *
 * "Then" is approximated as the *earliest real review* of this exact
 * sentence (any `sentence`-subject study item, e.g. `cloze`/
 * `reading_in_context`) — a genuine moment the learner had this sentence in
 * front of them, not a guess. "Then-unknown" is a linked vocabulary item
 * confirmed *after* that moment (`VocabularyItem.createdAt > thenAt`) — the
 * word didn't exist as a confirmed item yet when the sentence was first
 * reviewed. Both are v1 approximations (documented, not silently assumed
 * exact): a word confirmed for unrelated reasons around the same time isn't
 * really evidence the learner "didn't know" it then, and a re-imported/
 * merged vocabulary item's `createdAt` can drift from when it was first
 * truly learned. Only words with a resolvable clip span are counted, since
 * an unlocatable word can't be ducked.
 *
 * Pure: `buildThenAndNowClip` takes rows already resolved by the repository.
 */
export const THEN_AND_NOW_GAME_ID = 'then-and-now';
/** Clips per round — a short, purely reflective sequence. */
export const THEN_AND_NOW_ROUND_SIZE = 3;
/** Below this many days since "then", the comparison doesn't mean anything yet. */
export const THEN_AND_NOW_MIN_AGE_DAYS = 14;

export interface ThenAndNowWordSpan {
  vocabularyItemId: string;
  expression: string;
  startMs: number;
  endMs: number;
}

export interface ThenAndNowClip {
  sentenceId: string;
  japanese: string;
  translation: string;
  /** ISO timestamp of the sentence's earliest real review. */
  thenAt: string;
  /** Sorted by `startMs`. Always non-empty — see `buildThenAndNowClip`. */
  thenUnknownWords: ThenAndNowWordSpan[];
}

/**
 * Build a playable clip, or null when it isn't eligible: needs a
 * translation, "then" to be far enough in the past to mean something, and at
 * least one then-unknown word with a resolvable span to duck — otherwise
 * there is nothing to demonstrate.
 */
export function buildThenAndNowClip(input: {
  sentenceId: string;
  japanese: string;
  translation: string;
  thenAt: string;
  now?: Date;
  links: readonly { vocabularyItemId: string; expression: string; createdAt: string }[];
  spanByVocabularyItemId: ReadonlyMap<string, { startMs: number; endMs: number }>;
}): ThenAndNowClip | null {
  const now = input.now ?? new Date();
  if (!input.translation?.trim()) return null;
  const ageDays = (now.getTime() - Date.parse(input.thenAt)) / (24 * 60 * 60 * 1000);
  if (!(ageDays >= THEN_AND_NOW_MIN_AGE_DAYS)) return null;

  const thenUnknownWords: ThenAndNowWordSpan[] = [];
  const seen = new Set<string>();
  for (const link of input.links) {
    if (seen.has(link.vocabularyItemId) || link.createdAt <= input.thenAt) continue;
    const span = input.spanByVocabularyItemId.get(link.vocabularyItemId);
    if (!span) continue;
    seen.add(link.vocabularyItemId);
    thenUnknownWords.push({ vocabularyItemId: link.vocabularyItemId, expression: link.expression, ...span });
  }
  if (thenUnknownWords.length === 0) return null;

  return {
    sentenceId: input.sentenceId,
    japanese: input.japanese,
    translation: input.translation.trim(),
    thenAt: input.thenAt,
    thenUnknownWords: thenUnknownWords.sort((a, b) => a.startMs - b.startMs),
  };
}

/** The reflective "why this clip" line for the intro/result. */
export function describeThenAndNowClip(clip: Pick<ThenAndNowClip, 'thenAt' | 'thenUnknownWords'>, now: Date = new Date()): string {
  const days = Math.max(1, Math.round((now.getTime() - Date.parse(clip.thenAt)) / (24 * 60 * 60 * 1000)));
  const words = clip.thenUnknownWords.map((w) => w.expression).join('、');
  const count = clip.thenUnknownWords.length;
  return `You first read this sentence ${days} days ago. Back then you didn't know ${
    count === 1 ? 'this word' : `these ${count} words`
  }: ${words} — now you do.`;
}

/** Up to `size` clips from `order` (the caller shuffles for variety across "Play again"). */
export function buildThenAndNowRound<T extends ThenAndNowClip>(
  order: readonly T[],
  size: number = THEN_AND_NOW_ROUND_SIZE,
): T[] {
  return order.slice(0, size);
}
