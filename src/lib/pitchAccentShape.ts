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
 * Known, deliberate ambiguity: odaka (尾高, drop right after the last
 * mora) and heiban (平板, no drop) produce the IDENTICAL shape within a
 * word's own span — ['l', 'h', 'h', ...] either way. They only differ in
 * whether a *following* particle stays high (heiban) or drops (odaka),
 * which is outside any single word's own frames. `detectedDropPosition`
 * therefore can never report a detected "odaka" — collapsing that
 * distinction is what lets it stay honest about what's actually
 * observable from one word's audio, rather than guessing.
 * `pitchAccentObservations.ts` should compare
 * `detectedDropPosition(learnerClasses)` against
 * `detectedDropPosition(expectedPitchShape(moraCount, dictionaryPosition))`
 * (not the raw dictionary position) so an odaka target is never scored as
 * a mismatch against a correctly-produced heiban-shaped attempt.
 */

export type MoraPitchClass = 'h' | 'l';

export type PitchAccentPattern = 'heiban' | 'atamadaka' | 'nakadaka' | 'odaka';

/**
 * Expected relative high/low per mora for a dictionary accent `position`
 * (0 = heiban, 1 = atamadaka, N = nakadaka, N >= moraCount = odaka) over
 * `moraCount` morae.
 */
export function expectedPitchShape(moraCount: number, position: number): MoraPitchClass[] {
  if (moraCount <= 0) return [];
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
}

export function pitchPatternLabel(position: number, moraCount: number): PitchAccentPattern {
  if (position <= 0) return 'heiban';
  if (position === 1) return 'atamadaka';
  if (moraCount > 0 && position >= moraCount) return 'odaka';
  return 'nakadaka';
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
