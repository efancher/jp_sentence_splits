import { expectedPitchShape } from './pitchAccentShape';
import { segmentIntoMorae } from './mora';

/**
 * Real-audio pitch-perception bridge (docs/ROADMAP.md): "same/different"
 * near-minimal-pair trials — two words with the identical reading (a true
 * homophone) but a different dictionary pitch-accent position, e.g. 箸
 * (atamadaka) vs 橋 (heiban/odaka). Isolating accent as the only variable is
 * exactly what a synthetic-tone drill can't teach, since it never puts the
 * contrast in real mora timing/voicing/register.
 */
export interface MinimalPairWordSummary {
  vocabularyItemId: string;
  reading: string;
  /** `VocabularyItem.pitchAccentPositions[0]` — citation-form accent only. */
  position: number;
}

export interface MinimalPairContrast {
  reading: string;
  moraCount: number;
  a: MinimalPairWordSummary;
  b: MinimalPairWordSummary;
}

/**
 * Same-reading, different-position word pairs whose accent is actually
 * audible from the word alone — excludes heiban (position 0) vs. odaka
 * (position === moraCount) combinations, which produce an *identical*
 * in-word shape and only differ on a following particle
 * (see `pitchAccentShape.ts`'s module doc); a same/different trial built
 * from one of those would be unanswerable from the isolated clip alone.
 */
export function findMinimalPairContrasts(
  words: MinimalPairWordSummary[],
): MinimalPairContrast[] {
  const byReading = new Map<string, MinimalPairWordSummary[]>();
  for (const word of words) {
    const list = byReading.get(word.reading) ?? [];
    list.push(word);
    byReading.set(word.reading, list);
  }

  const contrasts: MinimalPairContrast[] = [];
  for (const [reading, list] of byReading) {
    const moraCount = segmentIntoMorae(reading).length;
    if (moraCount === 0) continue;
    const distinct = [...new Map(list.map((word) => [word.vocabularyItemId, word])).values()];
    for (let i = 0; i < distinct.length; i++) {
      for (let j = i + 1; j < distinct.length; j++) {
        const a = distinct[i]!;
        const b = distinct[j]!;
        if (a.position === b.position) continue;
        const shapeA = expectedPitchShape(moraCount, a.position).join('');
        const shapeB = expectedPitchShape(moraCount, b.position).join('');
        if (shapeA === shapeB) continue;
        contrasts.push({ reading, moraCount, a, b });
      }
    }
  }
  return contrasts;
}

export interface MinimalPairOccurrence extends MinimalPairWordSummary {
  /** The book the clip was mined into — a proxy for "same speaker" (STATUS.md). */
  bookId: string;
}

export interface MinimalPairTrial<TOccurrence extends MinimalPairOccurrence> {
  contrast: MinimalPairContrast;
  a: TOccurrence;
  b: TOccurrence;
  /** True when both clips come from the same book — the "same speaker" round. */
  sameBook: boolean;
}

/**
 * Up to `maxTrials` playable trials from `contrasts`, each pairing one
 * occurrence of word A with one of word B. Per contrast, prefers a
 * same-book pairing first (roadmap: "same-speaker first"), then a
 * cross-book pairing if the corpus has one — same near-minimal pair, harder
 * because the voice itself now differs too. A contrast with occurrences in
 * only one book contributes just the one trial.
 */
export function buildMinimalPairTrials<TOccurrence extends MinimalPairOccurrence>(
  contrasts: MinimalPairContrast[],
  occurrences: TOccurrence[],
  maxTrials = 5,
): MinimalPairTrial<TOccurrence>[] {
  const occurrencesByItemId = new Map<string, TOccurrence[]>();
  for (const occurrence of occurrences) {
    const list = occurrencesByItemId.get(occurrence.vocabularyItemId) ?? [];
    list.push(occurrence);
    occurrencesByItemId.set(occurrence.vocabularyItemId, list);
  }

  const trials: MinimalPairTrial<TOccurrence>[] = [];
  for (const contrast of contrasts) {
    if (trials.length >= maxTrials) break;
    const aOccurrences = occurrencesByItemId.get(contrast.a.vocabularyItemId) ?? [];
    const bOccurrences = occurrencesByItemId.get(contrast.b.vocabularyItemId) ?? [];
    if (aOccurrences.length === 0 || bOccurrences.length === 0) continue;

    const pairs = aOccurrences.flatMap((a) => bOccurrences.map((b) => ({ a, b })));
    const sameBook = pairs.find(({ a, b }) => a.bookId === b.bookId);
    if (sameBook) trials.push({ contrast, a: sameBook.a, b: sameBook.b, sameBook: true });

    if (trials.length >= maxTrials) break;
    const crossBook = pairs.find(({ a, b }) => a.bookId !== b.bookId);
    if (crossBook) trials.push({ contrast, a: crossBook.a, b: crossBook.b, sameBook: false });
  }
  return trials.slice(0, maxTrials);
}
