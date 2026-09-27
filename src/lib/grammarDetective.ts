import type { EffectiveGameSignal, GrammarPattern, Sentence, SentenceAudio, SentenceGrammar } from '../domain/types';
import type { PickerStats, SignalCopy } from './gamePicker';
import { isGrammarPatternAnswerCorrect, normalizeGrammarPatternKey } from './grammarPatterns';
import type { ReadingContext } from './readingContext';

/**
 * Grammar Detective (docs/ROADMAP.md "Short games", 2026-09-26 brainstorm):
 * Word Detective's clue-ladder format, sourced from tracked grammar patterns
 * instead of confirmed vocabulary. A pattern's single tracked sentence
 * (`pickContextSentenceForGrammarPattern`, the same pick the `grammar_completion`
 * review card uses) is enough to play — the differentiator clue is the
 * pattern's existing reading-order passage context rather than a second
 * distinct occurrence, since most tracked patterns only have the one. Typed
 * recall, graded with the same lenient `isGrammarPatternAnswerCorrect` the
 * review card uses.
 *
 * Pure: `buildGrammarDetectiveWord` takes rows already resolved by the
 * repository (which does the Dexie/`pickContextSentenceForGrammarPattern`
 * work), so eligibility and scoring are unit-testable without a database.
 */
export interface GrammarDetectiveWord {
  grammarPatternId: string;
  canonicalName: string;
  aliases: string[];
  shortMeaning: string;
  sentenceId: string;
  japanese: string;
  translation: string;
  surfaceForm?: string;
  audio?: SentenceAudio;
  readingContext: ReadingContext;
}

export type GrammarClueKind = 'translation' | 'context' | 'meaning' | 'first_kana' | 'audio';

export const GRAMMAR_CLUE_LABELS: Record<GrammarClueKind, string> = {
  translation: 'Translation',
  context: 'Surrounding sentences',
  meaning: 'Role',
  first_kana: 'First kana',
  audio: 'Hear it',
};

/** Patterns per round — same size/pace as Word Detective. */
export const GRAMMAR_DETECTIVE_ROUND_SIZE = 3;

/** Points for a clean, clue-free solve — mirrors Word Detective's scale. */
export const MAX_GRAMMAR_POINTS = 5;

/** Signal-round copy — grammar patterns, not vocabulary (the generic `describeRound`/`describePick` default). */
export const GRAMMAR_DETECTIVE_COPY: SignalCopy = {
  anyPool: 'your tracked grammar patterns',
  blurbs: {
    weak: "Patterns you've missed before on the grammar_completion card.",
    stale: "Patterns whose predicted recall has decayed the most.",
    strong: "Patterns you've been producing reliably — a relaxed round.",
  },
};

/** One-line "why this pattern" for the result screen — mirrors `describePick`, worded for grammar patterns. */
export function describeGrammarPick(signal: EffectiveGameSignal, stats: PickerStats): string {
  const pct = stats.retrievability === null ? null : Math.round(stats.retrievability * 100);
  switch (signal) {
    case 'weak':
      return `Missed ${stats.lapses}× on the grammar_completion card.`;
    case 'stale':
      return pct === null ? 'Fading from memory.' : `Predicted recall ~${pct}%.`;
    case 'strong':
      return pct === null ? 'A pattern you produce solidly.' : `A solid pattern (predicted recall ~${pct}%).`;
    case 'any':
      return stats.hasCard
        ? 'From your tracked grammar patterns.'
        : "Tracked, but you haven't reviewed it yet.";
  }
}

/**
 * Build a playable pattern from its resolved context sentence, or null when
 * it isn't eligible: needs a canonical name and a translation on the target
 * sentence — the only two things every clue-free guess needs. Every other
 * clue (context, role, audio) degrades gracefully when the data isn't there,
 * same as Word Detective's optional `meaning`/`audio` — most tracked
 * patterns have exactly one sentence, so requiring a second would starve the
 * game (the "check gate eligibility before shipping" lesson).
 */
export function buildGrammarDetectiveWord(input: {
  pattern: GrammarPattern;
  sentence: Sentence;
  sentenceGrammar: SentenceGrammar;
  readingContext: ReadingContext;
  audio?: SentenceAudio;
}): GrammarDetectiveWord | null {
  const { pattern, sentence, sentenceGrammar, readingContext, audio } = input;
  if (!pattern.canonicalName?.trim()) return null;
  if (!sentence.translation?.trim()) return null;
  return {
    grammarPatternId: pattern.id,
    canonicalName: pattern.canonicalName,
    aliases: pattern.aliases ?? [],
    shortMeaning: pattern.shortMeaning?.trim() ?? '',
    sentenceId: sentence.id,
    japanese: sentence.japanese,
    translation: sentence.translation.trim(),
    surfaceForm: sentenceGrammar.surfaceForm,
    audio,
    readingContext,
  };
}

/**
 * The clues this pattern can actually offer, in the order they're revealed.
 * `context`/`meaning`/`audio` are left out when there's nothing behind them;
 * `translation` and `first_kana` are always available (both are eligibility
 * requirements or derived from the always-present canonical name).
 */
export function buildGrammarClueLadder(word: GrammarDetectiveWord): GrammarClueKind[] {
  const ladder: GrammarClueKind[] = ['translation'];
  if (word.readingContext.before.length > 0 || word.readingContext.after.length > 0) {
    ladder.push('context');
  }
  if (word.shortMeaning) ladder.push('meaning');
  ladder.push('first_kana');
  if (word.audio) ladder.push('audio');
  return ladder;
}

/** First kana of the pattern's normalized (tilde/annotation-stripped) name. */
export function grammarFirstKana(word: Pick<GrammarDetectiveWord, 'canonicalName'>): string {
  const key = normalizeGrammarPatternKey(word.canonicalName);
  return Array.from(key)[0] ?? '';
}

/**
 * Whether `typed` names the pattern. Reuses the review card's own
 * `isGrammarPatternAnswerCorrect` (tilde/annotation/whitespace-insensitive)
 * against the canonical name, plus any known alias spelling.
 */
export function isGrammarDetectiveAnswerCorrect(word: GrammarDetectiveWord, typed: string): boolean {
  if (isGrammarPatternAnswerCorrect(typed, word.canonicalName)) return true;
  return word.aliases.some((alias) => isGrammarPatternAnswerCorrect(typed, alias));
}

export function scoreGrammarWord(input: {
  solved: boolean;
  cluesUsed: number;
  wrongGuesses: number;
}): number {
  if (!input.solved) return 0;
  return Math.max(1, MAX_GRAMMAR_POINTS - input.cluesUsed - input.wrongGuesses);
}
