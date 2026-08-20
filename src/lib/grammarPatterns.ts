import type { GrammarPattern } from '../domain/types';
import { hashString } from './ids';
import { stripMarkup } from './normalize';

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

export interface SentenceBlank {
  before: string;
  match: string;
  after: string;
}

/**
 * Best-effort blank for a grammar_completion review card (design brief
 * §11E): finds the first occurrence of the pattern's (tilde-stripped)
 * canonicalName as a literal substring of the sentence. Returns null when
 * it doesn't appear verbatim — common for conjugated/colloquial variants
 * (e.g. the sentence has わけない but the canonical name is わけがない) —
 * callers should fall back to showing the full, unblanked sentence rather
 * than guessing at a span. True span-based blanking would need real
 * start/end offsets on SentenceGrammar, which nothing populates yet (see
 * docs/STATUS.md).
 */
export function blankPatternInSentence(
  japanese: string,
  canonicalName: string,
): SentenceBlank | null {
  const needle = normalizeGrammarPatternKey(canonicalName);
  if (!needle) return null;
  const index = japanese.indexOf(needle);
  if (index === -1) return null;
  return {
    before: japanese.slice(0, index),
    match: needle,
    after: japanese.slice(index + needle.length),
  };
}

/** Default number of options on a grammar_completion multiple-choice card, including the correct one. */
export const GRAMMAR_COMPLETION_CHOICE_COUNT = 4;

/**
 * Multiple-choice options for a grammar_completion card: the correct
 * pattern plus up to `count - 1` distractors drawn from `otherPatterns`
 * (design brief §7/§8 — "distractors from confusable pairs when
 * available" is a natural future extension here once GrammarRelationship
 * data exists; for now this draws from the whole corpus). Both the
 * distractor pick and the final option order are deterministic, seeded
 * from the pattern's own id (same hash-based approach as
 * ReviewPage.tsx's pickTransformationTarget) — the same pattern always
 * gets the same choices in the same order across reloads/re-renders,
 * rather than reshuffling on every render.
 */
export function buildGrammarCompletionChoices(
  pattern: GrammarPattern,
  otherPatterns: readonly GrammarPattern[],
  count = GRAMMAR_COMPLETION_CHOICE_COUNT,
): GrammarPattern[] {
  const ranked = [...otherPatterns].sort((a, b) => {
    const ha = Number.parseInt(hashString(`${pattern.id}:pick:${a.id}`), 16);
    const hb = Number.parseInt(hashString(`${pattern.id}:pick:${b.id}`), 16);
    return ha - hb;
  });
  const distractors = ranked.slice(0, Math.max(0, count - 1));
  const choices = [pattern, ...distractors];
  return choices.sort((a, b) => {
    const ha = Number.parseInt(hashString(`${pattern.id}:order:${a.id}`), 16);
    const hb = Number.parseInt(hashString(`${pattern.id}:order:${b.id}`), 16);
    return ha - hb;
  });
}
