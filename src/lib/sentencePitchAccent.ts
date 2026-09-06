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
 *
 * `particleTail` is the one concession to *connected* speech: the run of
 * short grammatical particles that immediately follows the word in the
 * sentence (は・が・を・に・も・… — see `BUNSETSU_PARTICLE_KANA`) is pulled
 * into the word's accent phrase and marked at a single level — high after a
 * heiban/odaka-shaped word's particle would stay high, low after an
 * accented one (the same `particleHigh` rule the abstract trailing mark
 * already used). This is only the bunsetsu-level rule (particle attachment);
 * it deliberately stops at verb/copula okurigana (て・た・だ・で・…) and
 * multi-mora particles, and never bridges across to the next content word.
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
  /**
   * Short grammatical particles attached to this word in the sentence, one
   * kana per entry (empty when the word is followed by punctuation, kanji,
   * okurigana, or another marked word). Each is voiced at the `particleHigh`
   * level.
   */
  particleTail: string[];
  pattern: PitchAccentPattern;
}

/**
 * Single-kana grammatical particles that reliably cliticise onto the
 * preceding accent phrase and take its final level. Deliberately excludes
 * verb/copula okurigana (て・で・た・だ・な as a copula) and every
 * multi-mora particle (から・まで・のに・ので・だけ・…), several of which
 * carry their own accent — marking those needs real morphology, which this
 * module doesn't have.
 */
const BUNSETSU_PARTICLE_KANA = new Set(
  ['は', 'が', 'を', 'に', 'へ', 'と', 'も', 'の', 'や', 'か', 'ね', 'よ', 'わ', 'さ', 'ぞ', 'ぜ'],
);

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
      particleTail: [],
      pattern: pitchPatternLabel(position, morae.length),
    });
  }

  const sorted = results.sort((a, b) => {
    if (a.start !== b.start) {
      // Unlocated words (-1) sort to the end.
      if (a.start < 0) return 1;
      if (b.start < 0) return -1;
      return a.start - b.start;
    }
    return 0;
  });

  // Second pass: attach the run of short grammatical particles that follows
  // each located word, stopping before the next located word.
  for (let index = 0; index < sorted.length; index += 1) {
    const word = sorted[index]!;
    if (word.start < 0) continue;
    const tailStart = word.start + word.surfaceForm.length;
    let limit = japanese.length;
    for (let next = index + 1; next < sorted.length; next += 1) {
      const nextStart = sorted[next]!.start;
      if (nextStart >= tailStart) {
        limit = nextStart;
        break;
      }
    }
    const tail: string[] = [];
    for (let pos = tailStart; pos < limit; pos += 1) {
      const char = japanese[pos]!;
      if (!BUNSETSU_PARTICLE_KANA.has(char)) break;
      tail.push(char);
    }
    word.particleTail = tail;
  }

  return sorted;
}
