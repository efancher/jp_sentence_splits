/**
 * String-level repair for `reading_only` / `inline_reading` values that were
 * stored before `inlineReadingFromTokens` learned to fuse numerals with their
 * counters (see `japaneseNumberReading.ts`). Used by
 * `scripts/fix-numeral-readings.ts` to backfill the corpus, and as a
 * post-process on the server-supplied `reading_only` at import time so a
 * re-mine can't reintroduce a bare "2にん" / "1かげつ".
 *
 * Only touches spans that are unambiguously a digit + counter. Anything it
 * doesn't recognise is left exactly as-is.
 */
import { KNOWN_COUNTERS, readCounter, toAsciiDigits } from './japaneseNumberReading';

const DIGITS = '[0-9０-９]+';

// Kana spelling of each counter → the canonical surface `readCounter` wants.
// Order matters: longer spellings first so the alternation is greedy.
const KANA_COUNTERS: ReadonlyArray<readonly [kana: string, surface: string]> = [
  ['しゅうかん', '週間'],
  ['かげつ', 'ヶ月'],
  ['にん', '人'],
  ['ねん', '年'],
  ['ふん', '分'],
  ['さい', '歳'],
  ['ばん', '番'],
  ['わ', '羽'],
  ['つ', 'つ'],
];

const KANA_COUNTER_ALT = KANA_COUNTERS.map(([kana]) => kana).join('|');

/**
 * Fix a pure-kana `reading_only` string: "はい、20さいです" → "はい、はたちです",
 * "2にんとも" → "ふたりとも". A bare Arabic digit in `reading_only` (which is
 * meant to be a plain kana transcription) is always the bug.
 */
export function fixNumeralsInReadingOnly(readingOnly: string): string {
  if (!/[0-9０-９]/.test(readingOnly)) return readingOnly;
  const pattern = new RegExp(`(${DIGITS})(${KANA_COUNTER_ALT})`, 'g');
  return readingOnly.replace(pattern, (whole, digits: string, kana: string) => {
    const surface = KANA_COUNTERS.find(([k]) => k === kana)?.[1];
    if (!surface) return whole;
    const reading = readCounter(Number(toAsciiDigits(digits)), surface, kana);
    return reading ?? whole;
  });
}

const COUNTER_ALT = [...KNOWN_COUNTERS]
  .sort((a, b) => b.length - a.length)
  .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

/**
 * Fix Satori-style `inline_reading` markup. Two shapes:
 *
 *  - digit + counter directly before the bracket — recompute the reading:
 *    "2人[にん]" → "2人[ふたり]", "1ヶ月[かげつ]" → "1ヶ月[いっかげつ]".
 *  - digit + counter followed by more text (no bracket of its own) — give it
 *    one: "2つ先[さき]" → "2つ[ふたつ]先[さき]", trailing "2つ" → "2つ[ふたつ]".
 */
export function fixNumeralsInInlineReading(inlineReading: string): string {
  if (!inlineReading || !/[0-9０-９]/.test(inlineReading)) return inlineReading;

  const recompute = (digits: string, counter: string): string | null =>
    readCounter(Number(toAsciiDigits(digits)), counter);

  return inlineReading
    .replace(
      new RegExp(`(${DIGITS})(${COUNTER_ALT})(\\[[^\\]]*\\])`, 'g'),
      (whole, digits: string, counter: string) => {
        const reading = recompute(digits, counter);
        return reading ? `${digits}${counter}[${reading}]` : whole;
      },
    )
    .replace(
      new RegExp(`(${DIGITS})(${COUNTER_ALT})(?!\\[)`, 'g'),
      (whole, digits: string, counter: string) => {
        const reading = recompute(digits, counter);
        return reading ? `${digits}${counter}[${reading}]` : whole;
      },
    );
}
