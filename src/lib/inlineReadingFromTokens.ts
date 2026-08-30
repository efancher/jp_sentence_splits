import {
  KNOWN_COUNTERS,
  readCounter,
  readNumber,
  toAsciiDigits,
} from './japaneseNumberReading';
import type { MorphologyToken } from './vocabularySuggestions';

// Kanji, CJK compat ideographs, iteration marks, and 々〆〤ヶ — the same set
// the mining service's readings.py treats as "needs a reading". ヶ matters:
// 「1ヶ月」's ruby sits on a run containing ヶ.
const KANJI_RE = /[々〇㐀-鿿豈-﫿々〆〤ヶ]/;
const ALL_DIGITS_RE = /^[0-9０-９]+$/;

const COUNTER_SURFACES = new Set(KNOWN_COUNTERS);

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
 *
 * Arabic numerals are a special case: fugashi tags a bare digit as 数詞 with
 * no kana reading and reads a following counter in isolation (人→にん,
 * ヶ月→かげつ), so "2人" came through as "2にん" and the digit dropped out of
 * the mora row entirely. A digit token — optionally plus an adjacent counter
 * token — is merged into one ruby span with the fused reading from
 * `japaneseNumberReading` ("2人[ふたり]", "1ヶ月[いっかげつ]", "20歳[はたち]").
 */
export function inlineReadingFromTokens(
  japanese: string,
  tokens: MorphologyToken[],
): string {
  if (!tokens.length) return '';
  const ordered = [...tokens].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (let i = 0; i < ordered.length; i += 1) {
    const token = ordered[i]!;
    if (token.start < cursor || token.end > japanese.length) continue;
    if (japanese.slice(token.start, token.end) !== token.surface) continue;

    const numeral = ALL_DIGITS_RE.test(token.surface)
      ? readNumeralSpan(token, ordered[i + 1], japanese)
      : null;
    if (numeral) {
      out += japanese.slice(cursor, token.start);
      out += `${numeral.surface}[${numeral.reading}]`;
      cursor = numeral.end;
      if (numeral.consumedNext) i += 1;
      continue;
    }

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

interface NumeralSpan {
  surface: string;
  reading: string;
  end: number;
  consumedNext: boolean;
}

function readNumeralSpan(
  digitToken: MorphologyToken,
  nextToken: MorphologyToken | undefined,
  japanese: string,
): NumeralSpan | null {
  const value = Number(toAsciiDigits(digitToken.surface));
  if (!Number.isInteger(value)) return null;

  if (
    nextToken &&
    nextToken.start === digitToken.end &&
    nextToken.end <= japanese.length &&
    japanese.slice(nextToken.start, nextToken.end) === nextToken.surface &&
    COUNTER_SURFACES.has(nextToken.surface)
  ) {
    const reading = readCounter(value, nextToken.surface, nextToken.reading?.trim());
    if (reading) {
      return {
        surface: digitToken.surface + nextToken.surface,
        reading,
        end: nextToken.end,
        consumedNext: true,
      };
    }
  }

  const numberReading = readNumber(value);
  if (!numberReading) return null;
  return {
    surface: digitToken.surface,
    reading: numberReading,
    end: digitToken.end,
    consumedNext: false,
  };
}
