import { isHiragana, toHiragana } from 'wanakana';

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
}

function comparable(text: string): string {
  return toHiragana(normalizeSentenceKey(text).replace(/[\p{P}\p{S}]/gu, ''), {
    convertLongVowelMark: false,
  });
}

/**
 * Converts a romaji answer to kana, but only when everything left after
 * dropping spaces and punctuation becomes kana, so a stray latin typo can't
 * partially mutate into a match. Anything else is returned untouched.
 */
function romajiToKana(typed: string): string {
  if (!/[A-Za-z]/.test(typed)) return typed;
  const converted = toHiragana(typed.trim());
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
  const typed = romajiToKana(rawTyped);
  const targets = [japanese, ...(readingOnly && readingOnly.trim() ? [readingOnly] : [])];
  const typedChars = [...typed.trim()];
  const typedKey = comparable(typed);

  let best: { target: string; score: number; flags: { a: boolean[]; b: boolean[] } } | null = null;
  for (const target of targets) {
    const targetChars = [...target];
    const flags = lcsFlags(targetChars, typedChars);
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
  };
}
