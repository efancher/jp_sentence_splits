import { expectedPitchShape } from './pitchAccentShape';
import type { OddEarClip } from './oddEarOut';

/**
 * The in-word high/low string (one char per mora, e.g. `lhh`) for a
 * dictionary accent position — the same key `OddEarClip.shape` uses, so a
 * chosen answer on the `pitch_accent` card can be matched to real clips.
 * Heiban (0) and odaka (N) share one string: the difference sits in the
 * following particle, not in the word's own morae.
 */
export function inWordShapeKey(moraCount: number, position: number): string {
  return expectedPitchShape(moraCount, position).join('');
}

function hashString(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/**
 * A real word to show for "here's what the pattern you picked sounds like"
 * after a `pitch_accent` miss: same mora count and in-word shape as the
 * wrong answer, a different word from the card's own, preferring the same
 * book as the card's clip (the app's same-speaker proxy) so the ear compares
 * accent rather than voice. Returns null when the chosen and correct
 * answers share an in-word shape (heiban vs odaka — a word-only clip can't
 * show that difference) or no clip fits. Deterministic per target word, so
 * a re-render doesn't swap the example under the learner.
 */
export function pickContrastClip<T extends OddEarClip>(
  clips: readonly T[],
  options: {
    moraCount: number;
    chosenPosition: number;
    correctPosition: number;
    excludeVocabularyItemId: string;
    excludeReading: string;
    preferBookId?: string;
  },
): T | null {
  const wanted = inWordShapeKey(options.moraCount, options.chosenPosition);
  if (wanted === inWordShapeKey(options.moraCount, options.correctPosition)) return null;
  const fits = clips.filter(
    (clip) =>
      clip.moraCount === options.moraCount &&
      clip.shape === wanted &&
      clip.vocabularyItemId !== options.excludeVocabularyItemId &&
      clip.reading !== options.excludeReading,
  );
  if (fits.length === 0) return null;
  const sameBook = fits.filter((clip) => clip.bookId === options.preferBookId);
  const pool = sameBook.length > 0 ? sameBook : fits;
  const ordered = [...pool].sort((a, b) => a.vocabularyItemId.localeCompare(b.vocabularyItemId));
  return ordered[hashString(options.excludeVocabularyItemId) % ordered.length]!;
}
