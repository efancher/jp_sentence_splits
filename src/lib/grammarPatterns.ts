import type { GrammarRelationshipType } from '../domain/types';
import { normalizeSentenceKey, stripMarkup } from './normalize';

/** Human-readable labels for GrammarRelationshipType, for the detail page's "Related patterns" section. */
export const GRAMMAR_RELATIONSHIP_TYPE_LABELS: Record<GrammarRelationshipType, string> = {
  similar_meaning: 'Similar meaning',
  contrast: 'Contrasts with',
  commonly_confused: 'Commonly confused with',
  stronger_stance: 'Stronger stance than',
  weaker_stance: 'Weaker stance than',
  formal_variant: 'Formal variant of',
  structural_relative: 'Structurally related to',
};

export const GRAMMAR_RELATIONSHIP_TYPES: GrammarRelationshipType[] = [
  'similar_meaning',
  'contrast',
  'commonly_confused',
  'stronger_stance',
  'weaker_stance',
  'formal_variant',
  'structural_relative',
];

/**
 * Dedup key for GrammarPattern.canonicalName (see ensureGrammarPattern,
 * src/db/repository.ts). Strips leading/trailing tilde/wave-dash markers
 * (～/〜, both common in grammar-reference notation) and whitespace, then
 * NFC-normalizes, so "～わけがない", "〜わけがない", and "わけがない" all
 * resolve to the same canonical pattern.
 *
 * Deliberately *not* kanji/kana-variant-aware (e.g. 訳がない vs わけがない
 * still produce distinct keys) — that requires either a curated lookup or
 * AI-assisted merge-on-confirm, not exact-match dedup. A middle wave-dash is
 * preserved (e.g. "しか～ない"), since there it marks a real gap in the
 * pattern, not an attachment-point decoration.
 */
export function normalizeGrammarPatternKey(canonicalName: string): string {
  const text = stripMarkup(canonicalName).normalize('NFC');
  return text.replace(/^[~〜～\s]+|[~〜～\s]+$/g, '');
}

/**
 * Strips a parenthetical gloss (e.g. "（状態描写）", "(polite)") that a
 * canonicalName may carry to disambiguate senses of the same surface form
 * (e.g. ～ている（状態描写） vs ～ている（動作進行）). The gloss is part of
 * the pattern's *identity* for dedup (see normalizeGrammarPatternKey) but
 * is never literally present in real Japanese text, so callers that match
 * a canonicalName against an actual sentence/response must strip it first
 * or every such pattern fails unconditionally.
 */
function stripPatternAnnotation(text: string): string {
  return text.replace(/[（(][^）)]*[）)]/g, '').trim();
}

export interface SentenceBlank {
  before: string;
  match: string;
  after: string;
}

/**
 * Best-effort blank for a grammar_completion review card (design brief
 * §11E): finds the first occurrence of the pattern's (tilde-stripped,
 * annotation-stripped) canonicalName as a literal substring of the
 * sentence. Returns null when it doesn't appear verbatim — common for
 * conjugated/colloquial variants (e.g. the sentence has わけない but the
 * canonical name is わけがない) — callers should fall back to showing the
 * full, unblanked sentence rather than guessing at a span. True span-based
 * blanking would need real start/end offsets on SentenceGrammar, which
 * nothing populates yet (see docs/STATUS.md).
 */
export function blankPatternInSentence(
  japanese: string,
  canonicalName: string,
): SentenceBlank | null {
  const needle = stripPatternAnnotation(normalizeGrammarPatternKey(canonicalName));
  if (!needle) return null;
  const index = japanese.indexOf(needle);
  if (index === -1) return null;
  return {
    before: japanese.slice(0, index),
    match: needle,
    after: japanese.slice(index + needle.length),
  };
}

export type GrammarLearnerState = 'encountered' | 'noticed' | 'recognized';

/**
 * Derives the Encountered -> Noticed -> Recognized ladder from accumulated
 * evidence — never a manually-set field. Originally a 5-rung ladder whose
 * top two tiers (Distinguished/Productive) depended on FSRS proficiency on
 * dedicated `grammar_contrast`/`grammar_production` study items; those
 * activity types were retired 2026-09-15 (docs/ROADMAP.md) in favor of a
 * single `grammar_completion` card — `proficient` now reflects that card's
 * own FSRS state.
 */
export function computeGrammarLearnerState(input: {
  encounterCount: number;
  confirmedCount: number;
  tracked: boolean;
  proficient: boolean;
}): GrammarLearnerState {
  if (input.tracked && input.proficient) return 'recognized';
  if (input.confirmedCount > 0) return 'noticed';
  return 'encountered';
}

/** Human-readable labels for GrammarLearnerState, for badges on the list/detail pages. */
export const GRAMMAR_LEARNER_STATE_LABELS: Record<GrammarLearnerState, string> = {
  encountered: 'Encountered',
  noticed: 'Noticed',
  recognized: 'Recognized',
};

export type GrammarPriorityBucket =
  | 'worth_learning_now'
  | 'developing'
  | 'strong'
  | 'recently_encountered';

export const GRAMMAR_PRIORITY_BUCKET_LABELS: Record<GrammarPriorityBucket, string> = {
  worth_learning_now: 'Worth learning now',
  developing: 'Developing',
  strong: 'Strong',
  recently_encountered: 'Recently encountered',
};

/** Display order for the /grammar dashboard sections — most actionable first. */
export const GRAMMAR_PRIORITY_BUCKET_ORDER: GrammarPriorityBucket[] = [
  'worth_learning_now',
  'developing',
  'recently_encountered',
  'strong',
];

export interface GrammarPriorityInput {
  encounterCount: number;
  tracked: boolean;
  state: GrammarLearnerState;
  /** Among the tracked pattern's most recent grammar_completion reviews. */
  recentAgainCount: number;
  recentReviewCount: number;
}

/**
 * A simple, explainable heuristic (design brief §14 explicitly prefers this
 * over opaque scoring) grouping a pattern for the /grammar dashboard — four
 * buckets, each derivable at a glance from the same fields
 * explainGrammarPriority renders as prose, not a numeric score nobody can
 * audit.
 */
export function computeGrammarPriorityBucket(
  input: GrammarPriorityInput,
): GrammarPriorityBucket {
  if (input.state === 'recognized' && input.recentAgainCount === 0) return 'strong';
  if (input.tracked) return 'developing';
  if (input.encounterCount >= 3) return 'worth_learning_now';
  return 'recently_encountered';
}

/** Explainable one-liner behind a bucket assignment — design brief §14's own worked example. */
export function explainGrammarPriority(
  input: GrammarPriorityInput & { distinctSourceCount: number },
): string {
  const parts = [`Encountered ${input.encounterCount} time${input.encounterCount === 1 ? '' : 's'}`];
  if (input.distinctSourceCount > 1) {
    parts.push(`across ${input.distinctSourceCount} sources`);
  }
  if (input.tracked && input.recentReviewCount > 0) {
    parts.push(
      `needed help on ${input.recentAgainCount} of the last ${input.recentReviewCount} review${
        input.recentReviewCount === 1 ? '' : 's'
      }`,
    );
  } else if (!input.tracked) {
    parts.push('not tracked yet');
  }
  return `${parts.join(', ')}.`;
}

/**
 * Grades a learner's typed answer on a `grammar_completion` card (recall,
 * not multiple choice — see GrammarCompletionCard's doc comment,
 * 2026-09-17) against the pattern's canonical name. Reuses the exact same
 * normalization `blankPatternInSentence` and pattern-dedup
 * (`normalizeGrammarPatternKey`) already apply — a tilde, a parenthetical
 * sense-gloss, or incidental whitespace shouldn't fail an otherwise-right
 * answer. Deliberately *not* kanji/kana-variant-aware (same caveat as
 * `normalizeGrammarPatternKey`) — a pattern stored as 訳がない would reject
 * a typed わけがない; canonical names are conventionally kana already, so
 * this is rare in practice, not something to paper over with a guess.
 */
export function isGrammarPatternAnswerCorrect(typed: string, canonicalName: string): boolean {
  const key = (value: string) =>
    normalizeSentenceKey(stripPatternAnnotation(normalizeGrammarPatternKey(value)));
  const typedKey = key(typed);
  return typedKey.length > 0 && typedKey === key(canonicalName);
}
