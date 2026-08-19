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
