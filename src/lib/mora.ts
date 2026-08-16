import { parseInlineReadings } from './parseInlineReadings';

/**
 * Japanese mora-unit segmentation (shadowing pronunciation-feedback
 * Milestone 1, docs/STATUS.md Phase 9). Operates entirely on a sentence's
 * existing kana reading (`inlineReading`/`readingOnly`) — no tokenizer, no
 * server call. See docs/STATUS.md Phase 9 for why this is sufficient for
 * mora segmentation specifically (timing/alignment is a separate, later
 * milestone that does need real audio analysis).
 */

export type MoraUnitKind = 'sokuon' | 'moraic-n' | 'long-vowel-mark' | 'normal';

export interface MoraUnit {
  text: string;
  kind: MoraUnitKind;
  index: number;
  /** Which reading chunk (word) this mora came from, when that's known. */
  wordIndex?: number;
}

/** A run of kana text, optionally tied to a source word/segment. */
export interface ReadingChunk {
  text: string;
  wordIndex?: number;
}

/** Bump when the segmentation algorithm changes in a way that would alter output. */
export const MORA_SEGMENTATION_VERSION = 1;

// Small kana that merge into the *preceding* mora rather than starting a new
// one: the y-row (きゃ/しゅ/ちょ…), small vowels used in katakana loanword
// combinations (ファ/ティ/ウェ…), and small わ.
const SMALL_MERGE_KANA = new Set([
  'ゃ', 'ゅ', 'ょ', 'ゎ',
  'ャ', 'ュ', 'ョ', 'ヮ',
  'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ',
  'ァ', 'ィ', 'ゥ', 'ェ', 'ォ',
]);

const SOKUON = new Set(['っ', 'ッ']);
const MORAIC_N = new Set(['ん', 'ン']);
const LONG_VOWEL_MARK = new Set(['ー']);

const KANA_PATTERN = /[ぁ-ゖァ-ヺー]/;

function isKana(char: string): boolean {
  return KANA_PATTERN.test(char);
}

function kindFor(char: string): MoraUnitKind {
  if (SOKUON.has(char)) return 'sokuon';
  if (MORAIC_N.has(char)) return 'moraic-n';
  if (LONG_VOWEL_MARK.has(char)) return 'long-vowel-mark';
  return 'normal';
}

/**
 * Splits kana reading text into mora-like units. A single written kana is
 * NOT always one unit: small y-kana/vowel-kana merge into the previous unit
 * (きょ = 1 unit, not き+ょ); っ, ん, and ー each stand as their own unit.
 * Non-kana characters (punctuation, stray kanji, spaces) are skipped rather
 * than throwing, since source readings aren't guaranteed pristine.
 */
export function segmentIntoMorae(input: string | ReadingChunk[]): MoraUnit[] {
  const chunks: ReadingChunk[] = typeof input === 'string' ? [{ text: input }] : input;
  const units: MoraUnit[] = [];
  for (const chunk of chunks) {
    for (const char of Array.from(chunk.text)) {
      if (!isKana(char)) continue;
      if (SMALL_MERGE_KANA.has(char) && units.length > 0) {
        const previous = units[units.length - 1]!;
        previous.text += char;
        continue;
      }
      units.push({ text: char, kind: kindFor(char), index: units.length, wordIndex: chunk.wordIndex });
    }
  }
  return units;
}

/**
 * Resolves the best available kana reading for mora segmentation: prefers
 * `inlineReading` (Satori-style `小鳥[ことり]` markup, parsed for real word
 * boundaries) and falls back to the whole-sentence `readingOnly` string.
 * Returns null when neither is usable, mirroring the `hasReading` gate
 * already used by ShadowPage/AnalysisPanel confidence logic.
 */
export function getSentenceReadingForMora(sentence: {
  inlineReading: string;
  readingOnly: string;
}): ReadingChunk[] | null {
  if (sentence.inlineReading) {
    const segments = parseInlineReadings(sentence.inlineReading);
    if (segments.some((segment) => segment.kind === 'ruby')) {
      return segments.map((segment, wordIndex) => ({
        text: segment.reading ?? segment.base,
        wordIndex,
      }));
    }
  }
  if (sentence.readingOnly) {
    return [{ text: sentence.readingOnly }];
  }
  return null;
}
