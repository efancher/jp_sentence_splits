import { isHiragana, toHiragana } from 'wanakana';

import { normalizeSentenceKey } from './normalize';
import { parseInlineReadings } from './parseInlineReadings';

/**
 * Whether a learner's typed answer matches the expected reading, used both
 * for the ✓/✗ feedback on production/transformation cards and (via
 * `classifyReviewError`) for deciding *why* a review was wrong.
 *
 * `expected` may be a single reading or several acceptable ones (e.g. a
 * `reading_production` card accepts both the dictionary reading and the
 * inflected reading as it appears in the sentence — see
 * `surfaceReadingFromInline`); the answer is correct if it matches any.
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
export function isReadingAnswerCorrect(
  typed: string,
  expected: string | readonly string[],
): boolean {
  const typedKeys = new Set([normalizeSentenceKey(typed)]);
  const typedAsHiragana = toHiragana(typed.trim());
  if (typedAsHiragana && isHiragana(typedAsHiragana)) {
    typedKeys.add(normalizeSentenceKey(typedAsHiragana));
  }
  const expectedKeys = (typeof expected === 'string' ? [expected] : expected).flatMap(
    (value) => [
      normalizeSentenceKey(value),
      normalizeSentenceKey(toHiragana(value.trim())),
    ],
  );
  return [...typedKeys].some((key) => key.length > 0 && expectedKeys.includes(key));
}

/**
 * The kana reading of `surfaceForm` as it actually appears inflected in a
 * sentence, pulled out of the sentence's Satori-style `inlineReading`
 * (頑張[がんば]って → がんばって for surfaceForm 頑張って). Lets a
 * `reading_production` card accept the in-context reading alongside the
 * dictionary one, so a learner who reads the highlighted 頑張って off the
 * screen as がんばって isn't marked wrong for not back-forming がんばる.
 *
 * Returns null when it can't be derived unambiguously: no inline reading,
 * the surface form isn't found in it, or the match would split a single
 * ruby (furigana) group mid-word (kana can't be sliced across a kanji
 * cluster). Callers treat null as "no extra leniency," never an error.
 */
export function surfaceReadingFromInline(
  inlineReading: string | undefined,
  surfaceForm: string,
): string | null {
  if (!inlineReading || !surfaceForm) return null;
  const segments = parseInlineReadings(inlineReading);

  let baseText = '';
  const spans = segments.map((segment) => {
    const start = baseText.length;
    baseText += segment.base;
    return {
      start,
      end: baseText.length,
      isRuby: segment.kind === 'ruby',
      reading: segment.reading ?? segment.base,
    };
  });

  const startIndex = baseText.indexOf(surfaceForm);
  if (startIndex === -1) return null;
  const endIndex = startIndex + surfaceForm.length;

  let result = '';
  for (const span of spans) {
    if (span.end <= startIndex || span.start >= endIndex) continue;
    const fullyCovered = span.start >= startIndex && span.end <= endIndex;
    if (fullyCovered) {
      result += span.reading;
    } else if (!span.isRuby) {
      result += baseText.slice(Math.max(span.start, startIndex), Math.min(span.end, endIndex));
    } else {
      return null;
    }
  }
  const trimmed = result.replace(/\s+/g, '');
  return trimmed.length > 0 ? trimmed : null;
}
