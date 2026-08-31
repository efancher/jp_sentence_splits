import { segmentIntoMorae } from './mora';
import {
  expectedPitchShape,
  pitchPatternLabel,
  type MoraPitchClass,
  type PitchAccentPattern,
} from './pitchAccentShape';

/**
 * Per-word high/low pitch-accent marks for the words *in a sentence* that
 * carry Kanjium/UniDic dictionary accent data — the "H's and L's under the
 * kana" view shown on the shadowing panels, the analysis panel, and the
 * `pitch_accent` review card reveal.
 *
 * Deliberately per-word, not a single sentence contour: Japanese
 * sentence/compound accent (cross-word downstep, particle attachment,
 * rendaku-driven shifts) is not synchronically rule-governed and this
 * codebase never computes it (see `pitchAccentRules.ts` module doc). So
 * this renders one independent contour per confirmed content word, with
 * particles and unparsed/dataless words simply left unmarked, rather than
 * asserting a joined-up line that would often be wrong.
 *
 * The word's own morae come from its dictionary `reading`, so the marks are
 * exact for that word in isolation; only its *position* in the sentence is
 * approximate (first unclaimed `indexOf` of the surface form), which is
 * enough to order the per-word blocks left-to-right under the sentence.
 */
export interface SentenceWordAccent {
  surfaceForm: string;
  reading: string;
  /** Dictionary accent nucleus used: 0 = heiban, N = drop after mora N. */
  position: number;
  /** Character offset of `surfaceForm` in the sentence, or -1 if not found. */
  start: number;
  /** Mora-by-mora kana of the reading. */
  morae: string[];
  /** High/low per mora — same length as `morae`. */
  classes: MoraPitchClass[];
  /** Whether a following particle stays high (heiban only). */
  particleHigh: boolean;
  pattern: PitchAccentPattern;
}

export interface SentencePitchAccentTarget {
  surfaceForm: string;
  reading: string;
  pitchAccentPositions?: number[];
}

export function buildSentencePitchAccents(
  japanese: string,
  targets: SentencePitchAccentTarget[],
): SentenceWordAccent[] {
  const results: SentenceWordAccent[] = [];
  // Track how far each surface form has been consumed so a word that
  // appears twice lands under both occurrences rather than stacking on the
  // first.
  const cursorBySurface = new Map<string, number>();

  for (const target of targets) {
    const position = target.pitchAccentPositions?.[0];
    if (position === undefined || !Number.isFinite(position)) continue;
    const morae = segmentIntoMorae(target.reading).map((unit) => unit.text);
    if (morae.length === 0) continue;

    const from = cursorBySurface.get(target.surfaceForm) ?? 0;
    const found = target.surfaceForm ? japanese.indexOf(target.surfaceForm, from) : -1;
    if (found >= 0) {
      cursorBySurface.set(target.surfaceForm, found + target.surfaceForm.length);
    }

    results.push({
      surfaceForm: target.surfaceForm,
      reading: target.reading,
      position,
      start: found,
      morae,
      classes: expectedPitchShape(morae.length, position),
      particleHigh: position <= 0,
      pattern: pitchPatternLabel(position, morae.length),
    });
  }

  return results.sort((a, b) => {
    if (a.start !== b.start) {
      // Unlocated words (-1) sort to the end.
      if (a.start < 0) return 1;
      if (b.start < 0) return -1;
      return a.start - b.start;
    }
    return 0;
  });
}
