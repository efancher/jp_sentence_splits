import type { GrammarRelationshipType } from '../domain/types';
import { stripMarkup } from './normalize';

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
 * Best-effort in-sentence span for a grammar pattern (used by
 * `SentenceGrammarNoticeRow`'s ambient highlight on a review reveal):
 * finds the first occurrence of the pattern's (tilde-stripped,
 * annotation-stripped) canonicalName as a literal substring of the
 * sentence. Returns null when it doesn't appear verbatim — common for
 * conjugated/colloquial variants (e.g. the sentence has わけない but the
 * canonical name is わけがない) — callers should fall back to naming the
 * pattern next to the full, unmarked sentence rather than guessing at a
 * span. True span-based highlighting would need real start/end offsets on
 * SentenceGrammar, which nothing populates yet (see docs/STATUS.md).
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
 * activity types were retired 2026-09-15 (docs/ROADMAP.md "Grammar SRS:
 * noticing + in-context reading vs. the isolated drill ladder" — the
 * ladder rarely produced a card at all, and duplicated what
 * `reading_in_context` already tests once a pattern's sentence is
 * vocab-ready). Recognized now means "confirmed across more than one
 * occurrence" — repetition-across-contexts, the same signal
 * `distinctSourceCount` already uses for vocabulary maturity — rather than
 * a separate spaced-repetition card.
 */
export function computeGrammarLearnerState(input: {
  confirmedCount: number;
  distinctSourceCount: number;
}): GrammarLearnerState {
  if (input.confirmedCount > 0 && input.distinctSourceCount >= 2) return 'recognized';
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
  confirmedCount: number;
  distinctSourceCount: number;
  state: GrammarLearnerState;
}

/**
 * A simple, explainable heuristic grouping a pattern for the /grammar
 * dashboard — four buckets, each derivable at a glance from the same
 * fields explainGrammarPriority renders as prose, not a numeric score
 * nobody can audit.
 */
export function computeGrammarPriorityBucket(
  input: GrammarPriorityInput,
): GrammarPriorityBucket {
  if (input.state === 'recognized') return 'strong';
  if (input.confirmedCount > 0) return 'developing';
  if (input.encounterCount >= 3) return 'worth_learning_now';
  return 'recently_encountered';
}

/** Explainable one-liner behind a bucket assignment. */
export function explainGrammarPriority(input: GrammarPriorityInput): string {
  const parts = [`Encountered ${input.encounterCount} time${input.encounterCount === 1 ? '' : 's'}`];
  if (input.distinctSourceCount > 1) {
    parts.push(`across ${input.distinctSourceCount} sources`);
  }
  parts.push(input.confirmedCount > 0 ? 'confirmed noticing it' : 'not confirmed yet');
  return `${parts.join(', ')}.`;
}
