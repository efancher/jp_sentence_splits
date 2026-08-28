import type { MorphologyToken } from './vocabularySuggestions';

// Kanji, CJK compat ideographs, iteration marks, and 々〆〤ヶ — the same set
// the mining service's readings.py treats as "needs a reading". ヶ matters:
// 「1ヶ月」's ruby sits on a run containing ヶ.
const KANJI_RE = /[々〇㐀-鿿豈-﫿々〆〤ヶ]/;

/**
 * Build Satori-style inline-furigana markup (`漢字[かな]`) from a sentence's
 * morphology tokens — the `inlineReading` field the ruby renderer
 * (`parseInlineReadings.ts`) and mora segmentation (`mora.ts`) consume.
 *
 * The shadowing / YouTube-mining import path never produced this (it hardcodes
 * `inlineReading: ''` in `shadowingImport.ts`); only Satori CSV import did. The
 * re-segmentation flow needs it for its new sentences, and wiring it into the
 * mining import closes that gap going forward.
 *
 * Ruby is emitted only for a token whose surface contains kanji and whose
 * reading is present and actually differs from the surface. Text between
 * tokens (whitespace, punctuation the tokenizer skipped) is reproduced
 * verbatim from `japanese`, so the concatenation of all bases equals the
 * original string.
 */
export function inlineReadingFromTokens(
  japanese: string,
  tokens: MorphologyToken[],
): string {
  if (!tokens.length) return '';
  const ordered = [...tokens].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const token of ordered) {
    if (token.start < cursor || token.end > japanese.length) continue;
    if (japanese.slice(token.start, token.end) !== token.surface) continue;
    out += japanese.slice(cursor, token.start);
    const reading = token.reading?.trim() ?? '';
    if (reading && reading !== token.surface && KANJI_RE.test(token.surface)) {
      out += `${token.surface}[${reading}]`;
    } else {
      out += token.surface;
    }
    cursor = token.end;
  }
  out += japanese.slice(cursor);
  // No ruby anywhere → an all-kana sentence; store nothing rather than a
  // string identical to `japanese` (matches how `readingOnly` alone is used).
  return out.includes('[') ? out : '';
}
