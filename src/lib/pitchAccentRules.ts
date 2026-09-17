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
 *   (〜的/〜性/〜化/…), the verb / i-adjective two-class system, and the
 *   -masu family's fixed accent. Every heuristic note is cross-checked
 *   against the word's real Kanjium `position` before it's shown — if the
 *   rule and the dictionary disagree (an exception), we stay silent rather
 *   than assert something false.
 *
 * One exception to "only ever state things that are actually true": plain
 * nouns get a length-based *tendency* note (short nouns skew atamadaka/
 * heiban, long ones skew nakadaka near the antepenultimate mora) when this
 * word's own pattern happens to agree with it — worded as a tendency, never
 * a rule, since unlike everything else here it has real exceptions even
 * among words that "match". No note (not even the tendency) is shown for a
 * word that bucks it; the fallback ("must be memorized") still covers that
 * case and 4-mora nouns, where the source tendency doesn't make a claim.
 *
 * Deliberately NOT attempted: full compound-accent computation and
 * non-Tokyo dialects.
 */

import { conjugationWordClassFromPartOfSpeech, type ConjugationFormKey } from './conjugation';
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
  /**
   * Set when the tested occurrence is inflected (pitchAccentShift.ts's
   * `ResolvedPitchAccent.formKey`) — the citation form's own heiban/accented
   * class stops being the relevant fact for the -masu family, whose accent
   * is fixed on the "ma" mora regardless of it (see the ます/ました/ません
   * case in `predictInflectedPitchAccentPosition`, Wiktionary-verified).
   */
  conjugationFormKey?: ConjugationFormKey;
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
  // Mined vocabulary keeps its raw UniDic POS (e.g. "名詞/普通名詞") rather
  // than being backfilled to JMDict tags — see
  // scripts/backfill-vocabulary-jmdict-pos.ts's noted decision not to
  // rewrite noun rows. Recognize both shapes, mirroring
  // conjugationWordClassFromPartOfSpeech's UniDic handling above.
  if (
    partOfSpeech.startsWith('名詞') ||
    partOfSpeech.startsWith('代名詞') ||
    partOfSpeech.startsWith('数詞')
  ) {
    return true;
  }
  return partOfSpeech
    .split(/[,;]/)
    .map((tag) => tag.trim())
    .some((tag) => tag === 'n' || tag === 'n-pref' || tag === 'n-suf' || tag === 'pn');
}

export type VerbAdjectiveAccentClass = 'unaccented' | 'accented' | 'irregular';

/**
 * The two-class system verbs/i-adjectives are lexically split into:
 * unaccented (heiban, no downstep) or accented (downstep on the word's own
 * last mora — moraCount - 1). Anything else is an exception the two-class
 * system doesn't cover. Shared with pitchAccentShift.ts, which needs the
 * same classification to know whether a conjugated occurrence's downstep
 * can be safely carried forward.
 */
export function classifyVerbAdjectiveAccent(
  position: number,
  moraCount: number,
): VerbAdjectiveAccentClass {
  if (position === 0) return 'unaccented';
  if (moraCount >= 2 && position === moraCount - 1) return 'accented';
  return 'irregular';
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

const MASU_FAMILY_FORMS = new Set<ConjugationFormKey>([
  'polite_present',
  'polite_past',
  'polite_negative',
]);

function ruleNoteFor(input: PitchAccentRuleInput): string | undefined {
  const { expression, reading, partOfSpeech, position, moraCount, conjugationFormKey } = input;

  // 0. -masu family: overrides the citation form's own accent class — every
  //    verb takes the same downstep here regardless of heiban/accented.
  if (conjugationFormKey && MASU_FAMILY_FORMS.has(conjugationFormKey)) {
    const wordClass = conjugationWordClassFromPartOfSpeech(partOfSpeech);
    if (wordClass === 'godan' || wordClass === 'ichidan') {
      return 'The polite ます/ました/ません forms fix their own downstep right on the "ma" mora, regardless of whether the dictionary form is heiban or accented.';
    }
  }

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
    const accentClass = classifyVerbAdjectiveAccent(position, moraCount);
    if (accentClass === 'unaccented') {
      return 'Verbs come in just two accent classes. This is the unaccented (heiban) class — roughly half of all verbs — so it stays flat.';
    }
    if (accentClass === 'accented') {
      return 'Verbs come in just two accent classes. Accented verbs put the downstep on the second-to-last mora, as here.';
    }
    return undefined;
  }
  if (wordClass === 'i_adjective') {
    const accentClass = classifyVerbAdjectiveAccent(position, moraCount);
    if (accentClass === 'unaccented') {
      return 'A minority of i-adjectives are unaccented (heiban) and stay flat like this.';
    }
    if (accentClass === 'accented') {
      return 'Accented i-adjectives take the downstep on the second-to-last mora, as here.';
    }
    return undefined;
  }

  // 4. Plain nouns: no synchronic rule, but a length-based statistical
  //    tendency exists — only voiced when this word's own pattern agrees
  //    with it (see file doc comment for why this is worded as a tendency).
  if (hasNounTag(partOfSpeech) && !isKatakanaOnly(reading)) {
    const pattern = pitchPatternLabel(position, moraCount);
    if (moraCount >= 2 && moraCount <= 3 && (pattern === 'atamadaka' || pattern === 'heiban')) {
      return 'Short nouns (2–3 morae) tend toward atamadaka or heiban, as here — a statistical tendency, not a fixed rule.';
    }
    if (moraCount >= 5 && pattern === 'nakadaka' && position === moraCount - 2) {
      return 'Long nouns (5+ morae) tend toward nakadaka with the fall around the antepenultimate (third-from-last) mora, as here — a statistical tendency, not a fixed rule.';
    }
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
