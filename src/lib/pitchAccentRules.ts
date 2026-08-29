/**
 * Plain-language "what does this pattern mean, and why might this word take
 * it" copy for the `pitch_accent` review card reveal (ReviewPage's
 * `PitchAccentCard`, under `PitchAccentDiagram`).
 *
 * Two independent pieces:
 * - `patternGloss` — always present, just describes the H/L contour the
 *   diagram already draws (heiban / atamadaka / nakadaka / odaka).
 * - `ruleNote` — optional, only emitted for the handful of cases where
 *   Japanese pitch accent is actually rule-governed: recent loanwords
 *   (antepenultimate-mora tendency), pre-accenting suffix compounds
 *   (〜的/〜性/〜化/…), and the verb / i-adjective two-class system. Every
 *   heuristic note is cross-checked against the word's real Kanjium
 *   `position` before it's shown — if the rule and the dictionary disagree
 *   (an exception), we stay silent rather than assert something false.
 *
 * Deliberately NOT attempted: simplex native-noun accent (lexical /
 * historical, no synchronic rule — the fallback note says so), full
 * compound-accent computation, and non-Tokyo dialects.
 */

import { conjugationWordClassFromPartOfSpeech } from './conjugation';
import { segmentIntoMorae } from './mora';
import { pitchPatternLabel } from './pitchAccentShape';

export interface PitchAccentRuleInput {
  expression: string;
  reading: string;
  /** JMDict POS tags, comma/semicolon separated (e.g. "n", "v5r,vt", "adj-i"). */
  partOfSpeech?: string;
  /** Dictionary accent nucleus: 0 = heiban, N = downstep after mora N. */
  position: number;
  moraCount: number;
}

export interface PitchAccentExplanation {
  /** What the drawn contour means. Always present. */
  patternGloss: string;
  /** A heuristic reason this word takes this pattern, when one applies. */
  ruleNote?: string;
}

const PATTERN_GLOSS: Record<string, string> = {
  heiban:
    'Heiban: no downstep. Pitch steps up after the first mora and stays high — a following particle stays high too.',
  atamadaka:
    'Atamadaka: the first mora is high, then pitch drops immediately and stays low for the rest of the word.',
  nakadaka:
    'Nakadaka: pitch rises, holds high across the middle, then drops before the end of the word.',
  odaka:
    'Odaka: every mora after the first is high, but the downstep lands right at the end — you only hear it as a following particle dropping to low.',
};

const ONE_MORA_GLOSS: Record<string, string> = {
  heiban: 'Heiban: this one-mora word stays high, and a following particle stays high too.',
  atamadaka:
    'Atamadaka: this one-mora word is high on its own, but a following particle drops to low.',
};

/** Kanji suffixes that reliably pull the downstep onto the mora just before them, with the suffix's length in morae. */
const PRE_ACCENTING_SUFFIXES: { kanji: string; suffixMorae: number }[] = [
  { kanji: '的', suffixMorae: 2 }, // 〜てき
  { kanji: '性', suffixMorae: 2 }, // 〜せい
  { kanji: '化', suffixMorae: 1 }, // 〜か
  { kanji: '学', suffixMorae: 2 }, // 〜がく
  { kanji: '者', suffixMorae: 1 }, // 〜しゃ
];

function hasNounTag(partOfSpeech: string | undefined): boolean {
  if (!partOfSpeech) return false;
  return partOfSpeech
    .split(/[,;]/)
    .map((tag) => tag.trim())
    .some((tag) => tag === 'n' || tag === 'n-pref' || tag === 'n-suf' || tag === 'pn');
}

function isKatakanaOnly(text: string): boolean {
  // Katakana block U+30A0–U+30FF, which includes the ー prolonged-sound mark.
  return /^[゠-ヿ]+$/.test(text);
}

/**
 * Antepenultimate-mora prediction for a loanword: the downstep falls on
 * the 3rd mora from the end (1-based index `moraCount - 2`), shifted one
 * mora earlier when that mora is the "weak" second half of a heavy
 * syllable (long-vowel mark, moraic ん, or っ).
 */
function loanwordPredictedPosition(reading: string, moraCount: number): number | null {
  if (moraCount < 3) return null;
  let predicted = moraCount - 2;
  const morae = segmentIntoMorae(reading);
  const antepenult = morae[predicted - 1];
  if (antepenult && antepenult.kind !== 'normal') {
    predicted -= 1;
  }
  return predicted > 0 ? predicted : null;
}

function ruleNoteFor(input: PitchAccentRuleInput): string | undefined {
  const { expression, reading, partOfSpeech, position, moraCount } = input;

  // 1. Pre-accenting suffix compounds — only when the dictionary agrees the
  //    downstep is immediately before the suffix.
  for (const { kanji, suffixMorae } of PRE_ACCENTING_SUFFIXES) {
    if (expression.endsWith(kanji) && expression.length > 1) {
      if (position === moraCount - suffixMorae && position > 0) {
        return `The suffix 〜${kanji} is pre-accenting: it pulls the downstep onto the mora right before it, which is what happens here.`;
      }
      return undefined;
    }
  }

  // 2. Loanwords (katakana).
  if (isKatakanaOnly(reading) || (!reading && isKatakanaOnly(expression))) {
    if (position === 0) {
      return 'Established loanwords often shed their accent over time and settle into heiban.';
    }
    const predicted = loanwordPredictedPosition(reading || expression, moraCount);
    if (predicted !== null && position === predicted) {
      return 'Borrowed words tend to take a downstep around the third-from-last mora — this one follows that default.';
    }
    return undefined;
  }

  // 3. Verb / i-adjective two-class system.
  const wordClass = conjugationWordClassFromPartOfSpeech(partOfSpeech);
  if (wordClass === 'godan' || wordClass === 'ichidan' || wordClass === 'kuru' || wordClass === 'suru') {
    if (position === 0) {
      return 'Verbs come in just two accent classes. This is the unaccented (heiban) class — roughly half of all verbs — so it stays flat.';
    }
    if (moraCount >= 2 && position === moraCount - 1) {
      return 'Verbs come in just two accent classes. Accented verbs put the downstep on the second-to-last mora, as here.';
    }
    return undefined;
  }
  if (wordClass === 'i_adjective') {
    if (position === 0) {
      return 'A minority of i-adjectives are unaccented (heiban) and stay flat like this.';
    }
    if (moraCount >= 2 && position === moraCount - 1) {
      return 'Accented i-adjectives take the downstep on the second-to-last mora, as here.';
    }
    return undefined;
  }

  // 4. Fallback: plain native nouns have no rule.
  if (hasNounTag(partOfSpeech) && !isKatakanaOnly(reading)) {
    return 'Noun accent mostly has to be memorized — for a plain (non-compound) native word there is no reliable rule that predicts it.';
  }

  return undefined;
}

export function explainPitchAccent(input: PitchAccentRuleInput): PitchAccentExplanation {
  const pattern = pitchPatternLabel(input.position, input.moraCount);
  const patternGloss =
    (input.moraCount === 1 ? ONE_MORA_GLOSS[pattern] : undefined) ??
    PATTERN_GLOSS[pattern] ??
    PATTERN_GLOSS.heiban!;
  return { patternGloss, ruleNote: ruleNoteFor(input) };
}
