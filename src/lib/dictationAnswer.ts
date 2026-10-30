import { isHiragana, toHiragana, toKana, toRomaji } from 'wanakana';

import { fixNumeralsInReadingOnly } from './fixNumeralReadings';
import { normalizeSentenceKey } from './normalize';

export interface DictationSegment {
  text: string;
  matched: boolean;
}

export interface DictationGrade {
  correct: boolean;
  /** The target the answer was compared to: the written sentence or its kana reading, whichever the answer is closer to. */
  gradedAgainst: string;
  /** The graded target split into runs the learner got / missed. */
  expectedSegments: DictationSegment[];
  /** What the learner typed split into runs that matched / were extra or wrong. */
  typedSegments: DictationSegment[];
  /** The kana the answer was graded as (romaji converted); the raw answer when nothing was converted. */
  typedKana: string;
}

/** を is only ever the particle, pronounced お, and romaji can only produce お; compare by sound. */
const foldWo = (text: string) => text.replace(/を/g, 'お');

/**
 * Loanword ティ/ディ/トゥ/ドゥ are what plain romaji ti/di/tu/du type as ち/ぢ/つ/づ (thi/dhi/twu/dwu make the
 * real ones), so compare them as the plain-romaji kana. Applied to both sides, so either way of typing works.
 */
function foldLoanSyllables(hiragana: string): string {
  return hiragana.replace(/てぃ/g, 'ち').replace(/でぃ/g, 'ぢ').replace(/とぅ/g, 'つ').replace(/どぅ/g, 'づ');
}

const HIRAGANA_CHAR = /^[ぁ-ゖ]$/u;
const VOWEL_KANA: Record<string, string> = { a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お' };

/**
 * Long vowels by sound, written the hiragana way: ー repeats the vowel before it, and the
 * おう/えい spellings of long o/e are the same as おお/ええ (ポーランド = ぽうらんど = ぽおらんど).
 */
function foldLongVowels(hiragana: string): string {
  let out = '';
  for (const char of hiragana) {
    const previous = out.slice(-1);
    const vowel = HIRAGANA_CHAR.test(previous) ? toRomaji(previous).slice(-1) : '';
    if (char === 'ー' && VOWEL_KANA[vowel]) out += VOWEL_KANA[vowel];
    else if (char === 'う' && vowel === 'o') out += 'お';
    else if (char === 'い' && vowel === 'e') out += 'え';
    else out += char;
  }
  return out;
}

function comparable(text: string): string {
  return foldLongVowels(
    foldLoanSyllables(
      foldWo(
        toHiragana(normalizeSentenceKey(text).replace(/[\p{P}\p{S}]/gu, ''), {
          convertLongVowelMark: false,
        }),
      ),
    ),
  );
}

/** Per-character key for the diff: same folding as `comparable` (width, kana script, case). */
function diffKey(char: string): string {
  return foldWo(toHiragana(char.normalize('NFKC').toLowerCase(), { convertLongVowelMark: false }));
}

/**
 * Converts a romaji answer to kana, but only when everything left after
 * dropping spaces and punctuation becomes kana, so a stray latin typo can't
 * partially mutate into a match. Anything else is returned untouched.
 */
function romajiToKana(typed: string, nBeforeY = false): string {
  if (!/[A-Za-z]/.test(typed)) return typed;
  // "zenzenyuki": plain conversion reads "nyu" as にゅ; the apostrophe forces ん + ゆ.
  const source = nBeforeY ? typed.trim().replace(/n(?=y)/gi, "n'") : typed.trim();
  const converted = toHiragana(source);
  const core = converted.replace(/[\p{P}\p{S}\s]/gu, '');
  return core && isHiragana(core) ? converted : typed;
}

/** Longest-common-subsequence membership flags for each side. */
function lcsFlags(a: string[], b: string[]): { a: boolean[]; b: boolean[] } {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const flagsA = new Array<boolean>(a.length).fill(false);
  const flagsB = new Array<boolean>(b.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      flagsA[i] = true;
      flagsB[j] = true;
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return { a: flagsA, b: flagsB };
}

const IGNORED_CHAR = /[\p{P}\p{S}\s]/u;

function toSegments(chars: string[], flags: boolean[]): DictationSegment[] {
  const segments: DictationSegment[] = [];
  chars.forEach((char, index) => {
    const matched = flags[index]! || IGNORED_CHAR.test(char);
    const last = segments[segments.length - 1];
    if (last && last.matched === matched) last.text += char;
    else segments.push({ text: char, matched });
  });
  return segments;
}

/**
 * Grades a typed dictation against the sentence. The answer is accepted if
 * it matches either the written sentence or its kana reading (a learner
 * without the kanji can still show they heard it), ignoring whitespace,
 * punctuation and hiragana/katakana. A fully-romaji answer is converted to
 * kana first (は/を must be typed ha/wo). The diff is drawn against whichever of
 * the two the answer is closer to.
 */
export function gradeDictation(
  rawTyped: string,
  japanese: string,
  readingOnly?: string,
): DictationGrade {
  const plain = gradeConverted(romajiToKana(rawTyped), japanese, readingOnly);
  if (plain.correct || !/ny/i.test(rawTyped)) return plain;
  // Romaji can't tell ん+や-row (zenzenyuki) from に+ゃ-row (nyu); give the learner the benefit of the doubt.
  const alt = gradeConverted(romajiToKana(rawTyped, true), japanese, readingOnly);
  return alt.correct ? alt : plain;
}

function gradeConverted(typed: string, japanese: string, readingOnly?: string): DictationGrade {
  const targets = [
    japanese,
    ...(readingOnly && readingOnly.trim() ? [fixNumeralsInReadingOnly(readingOnly)] : []),
  ];
  const typedChars = [...typed.trim()];
  const typedKey = comparable(typed);

  let best: { target: string; score: number; flags: { a: boolean[]; b: boolean[] } } | null = null;
  for (const target of targets) {
    const targetChars = [...target];
    const flags = lcsFlags(targetChars.map(diffKey), typedChars.map(diffKey));
    const score = flags.a.filter(Boolean).length / Math.max(targetChars.length, 1);
    if (!best || score > best.score) best = { target, score, flags };
  }
  const chosen = best!;
  const correct =
    typedKey.length > 0 && targets.some((target) => comparable(target) === typedKey);
  const targetChars = [...chosen.target];
  return {
    correct,
    gradedAgainst: correct
      ? (targets.find((target) => comparable(target) === typedKey) ?? chosen.target)
      : chosen.target,
    expectedSegments: toSegments(targetChars, chosen.flags.a),
    typedSegments: toSegments(typedChars, chosen.flags.b),
    typedKana: typed.trim(),
  };
}

/**
 * The typed answer with any romaji converted to kana (lowercase → hiragana,
 * uppercase → katakana). Null when there's nothing to convert, so the UI can
 * skip a redundant second line.
 */
export function typedAsKana(typed: string): string | null {
  const trimmed = typed.trim();
  if (!/[A-Za-z]/.test(trimmed)) return null;
  const converted = toKana(trimmed);
  return converted === trimmed ? null : converted;
}
