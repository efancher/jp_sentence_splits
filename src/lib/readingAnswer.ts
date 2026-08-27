import { isHiragana, toHiragana } from 'wanakana';

import { normalizeSentenceKey } from './normalize';

/**
 * Whether a learner's typed answer matches the expected reading, used both
 * for the ✓/✗ feedback on production/transformation cards and (via
 * `classifyReviewError`) for deciding *why* a review was wrong.
 *
 * Comparison is:
 * - whitespace/NFC-insensitive, via `normalizeSentenceKey` (same as
 *   sentence-identity matching);
 * - lenient about kana form — both sides are also compared as hiragana, so
 *   a learner with no Japanese IME can type the reading in romaji (e.g.
 *   "sureba" for すれば) and an expected reading stored as katakana (イク)
 *   still matches.
 *
 * The romaji path is only trusted when the whole input converts to kana, so
 * a stray latin typo can't partially mutate into a match — mirrors
 * `matchesVocabularySearch` in VocabularyListPage. For non-reading answers
 * that also flow through here (grammar pattern names, pitch-accent labels)
 * `toHiragana` leaves them alone / `isHiragana` rejects the conversion, so
 * it degrades to plain normalized equality.
 */
export function isReadingAnswerCorrect(typed: string, expected: string): boolean {
  const typedKeys = new Set([normalizeSentenceKey(typed)]);
  const typedAsHiragana = toHiragana(typed.trim());
  if (typedAsHiragana && isHiragana(typedAsHiragana)) {
    typedKeys.add(normalizeSentenceKey(typedAsHiragana));
  }
  const expectedKeys = [
    normalizeSentenceKey(expected),
    normalizeSentenceKey(toHiragana(expected.trim())),
  ];
  return [...typedKeys].some((key) => key.length > 0 && expectedKeys.includes(key));
}
