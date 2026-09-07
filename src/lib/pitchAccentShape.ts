/**
 * Predicted per-mora high/low pitch shape from a dictionary accent
 * position, and the matching "what shape did the learner actually
 * produce" detector — the two halves `pitchAccentObservations.ts` needs
 * to compare a recording against real pitch-accent ground truth (Kanjium,
 * via `scripts/backfill-pitch-accent.ts` -> `VocabularyItem.pitchAccentPositions`)
 * instead of only another recording.
 *
 * `expectedPitchShape`/`pitchPatternLabel` are a direct port of the
 * classification logic in ~/projects/anki/immersion_pitch.py's
 * `pitch_graph_html`/`pitch_pattern_label` (that file also renders HTML
 * graphs — deliberately not ported, this module only needs the
 * classification).
 *
 * Known ambiguity, only resolvable with the following mora: odaka (尾高,
 * drop right after the last mora) and heiban (平板, no drop) produce the
 * IDENTICAL shape within a word's own span — ['l', 'h', 'h', ...] either
 * way. They differ only in whether a *following* particle stays high
 * (heiban) or drops (odaka). When the caller has actually measured that
 * following mora it passes `hasFollowingMora` to `expectedPitchShape`,
 * which then appends the particle's level ('h' for heiban, 'l' for every
 * accented pattern) so `detectedDropPosition` can report an odaka drop at
 * `moraCount`. With the 2-arg call (no following mora observed) the two
 * stay collapsed — `detectedDropPosition` can't report "odaka" and
 * `pitchAccentObservations.ts` compares
 * `detectedDropPosition(learnerClasses)` against
 * `detectedDropPosition(expectedPitchShape(moraCount, dictionaryPosition))`
 * so an odaka target is never scored as a mismatch against a
 * correctly-produced heiban-shaped attempt.
 */

export type MoraPitchClass = 'h' | 'l';

export type PitchAccentPattern = 'heiban' | 'atamadaka' | 'nakadaka' | 'odaka';

/**
 * Expected relative high/low per mora for a dictionary accent `position`
 * (0 = heiban, 1 = atamadaka, N = nakadaka, N >= moraCount = odaka) over
 * `moraCount` morae.
 *
 * When `hasFollowingMora` is true the result has one extra trailing
 * element for the mora right after the word (a grammatical particle in the
 * same accent phrase): 'h' for heiban — the pitch stays up — and 'l' for
 * every accented pattern, which has already dropped by then. This is the
 * only cue that separates odaka from heiban (see module doc); pass it only
 * when that mora was actually measured.
 */
export function expectedPitchShape(
  moraCount: number,
  position: number,
  hasFollowingMora = false,
): MoraPitchClass[] {
  if (moraCount <= 0) return [];
  const base = ((): MoraPitchClass[] => {
    if (position <= 0) {
      // Heiban (and, within the word's own span, odaka — see module doc).
      return moraCount > 1 ? ['l', ...(Array(moraCount - 1).fill('h') as MoraPitchClass[])] : ['h'];
    }
    if (position === 1) {
      return moraCount > 1 ? ['h', ...(Array(moraCount - 1).fill('l') as MoraPitchClass[])] : ['h'];
    }
    const dropAfter = Math.min(position, moraCount);
    const classes: MoraPitchClass[] = [];
    for (let index = 0; index < moraCount; index += 1) {
      const moraNumber = index + 1;
      if (moraNumber === 1) classes.push('l');
      else if (moraNumber <= dropAfter) classes.push('h');
      else classes.push('l');
    }
    return classes;
  })();
  return hasFollowingMora ? [...base, position <= 0 ? 'h' : 'l'] : base;
}

export function pitchPatternLabel(position: number, moraCount: number): PitchAccentPattern {
  if (position <= 0) return 'heiban';
  if (position === 1) return 'atamadaka';
  if (moraCount > 0 && position >= moraCount) return 'odaka';
  return 'nakadaka';
}

/**
 * Which pitch-accent categories are actually distinguishable for a word
 * with `moraCount` morae — for building a fair multiple-choice review
 * card, not just labeling a known position. Reasoned directly from
 * `pitchPatternLabel`'s own branch order over every real position
 * `0..moraCount`:
 * - 1 mora: only positions 0 and 1 exist. Position 1 hits the
 *   `position === 1` branch *before* the odaka check ever runs, so odaka
 *   is unreachable — only heiban/atamadaka are real choices.
 * - 2 morae: positions 0, 1, 2. Position 2 (`>= moraCount`) is odaka; there
 *   is no integer strictly between 1 and moraCount for nakadaka to occupy.
 * - 3+ morae: all four are reachable.
 * Offering an unreachable label as a distractor would be an unfair (or
 * literally unwinnable, if it were somehow the "correct" one) choice, not
 * a legitimate wrong answer.
 */
export function possiblePitchPatternsForMoraCount(moraCount: number): PitchAccentPattern[] {
  if (moraCount <= 0) return [];
  if (moraCount === 1) return ['heiban', 'atamadaka'];
  if (moraCount === 2) return ['heiban', 'atamadaka', 'odaka'];
  return ['heiban', 'atamadaka', 'nakadaka', 'odaka'];
}

/**
 * The 1-based mora index of the first h->l transition in `classes` (i.e.
 * the last high mora before the drop), or 0 if the sequence never drops
 * (heiban- and odaka-shaped alike — see module doc). This is the
 * acoustic-comparison primitive: it has no dictionary-position input, only
 * an observed or predicted h/l sequence, so the same function scores both
 * "what did the learner produce" and "what does the dictionary predict,"
 * keeping the two directly comparable.
 */
export function detectedDropPosition(classes: MoraPitchClass[]): number {
  for (let index = 0; index < classes.length - 1; index += 1) {
    if (classes[index] === 'h' && classes[index + 1] === 'l') {
      return index + 1;
    }
  }
  return 0;
}
