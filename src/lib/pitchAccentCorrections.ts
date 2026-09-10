/**
 * "Why did my pitch come out that shape, and what should I physically do
 * differently" coaching for the pitch-accent drill / shadowing analysis.
 *
 * `pitchAccentObservations.ts` already decides *that* a recording's per-mora
 * H/L shape diverges from the dictionary; this turns that raw divergence
 * into a named failure mode plus an actionable practice cue. Several of the
 * cues attribute the tendency to an English-speaker habit (initial stress,
 * utterance-final declination, marking prominence with loudness instead of
 * pitch) — that transfer is by far the most common cause for this user, and
 * naming it is what makes the cue stick (their own feedback: a hint that
 * says *why* "practise the last mora extra high" works better than the bare
 * instruction).
 *
 * Pure and display-only. The h/l arrays it takes are the same rough
 * equal-width-bucket estimate the rest of this feedback system runs on, so
 * callers gate on voiced coverage before trusting a single-mora diff.
 */

import { detectedDropPosition, type MoraPitchClass } from './pitchAccentShape';

export type PitchAccentCorrectionKind =
  | 'first-mora-high'
  | 'final-fall'
  | 'particle-fall'
  | 'held-high'
  | 'early-drop'
  | 'no-downstep'
  | 'flat'
  | 'generic';

export interface PitchAccentCorrection {
  kind: PitchAccentCorrectionKind;
  /** One sentence naming what diverged, in mora terms. */
  summary: string;
  /** Actionable practice cue — what to do differently on the next take. */
  hint: string;
}

export interface PitchAccentDeviationInput {
  surfaceForm: string;
  /** The word's morae as kana, in order (length = the word row length). */
  moraeText: string[];
  /** Dictionary H/L, one per mora, optionally with a trailing particle mora. */
  expected: MoraPitchClass[];
  /** Learner's measured H/L — must be the same length as `expected`. */
  actual: MoraPitchClass[];
  /** Whether `expected`/`actual` carry a trailing element for the following particle. */
  hasFollowing: boolean;
  /** The following particle's kana, when known — for naming it in the copy. */
  followingText?: string;
}

/**
 * The single most useful correction for how `actual` diverges from
 * `expected`, or null when they match (or the inputs don't line up). Checks
 * run most-specific first; the first match wins.
 */
export function diagnosePitchAccentDeviation({
  surfaceForm,
  moraeText,
  expected,
  actual,
  hasFollowing,
  followingText,
}: PitchAccentDeviationInput): PitchAccentCorrection | null {
  const wordLen = moraeText.length;
  if (wordLen === 0 || expected.length !== actual.length || expected.length < wordLen) {
    return null;
  }

  const expWord = expected.slice(0, wordLen);
  const actWord = actual.slice(0, wordLen);
  const diffs: number[] = [];
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] !== actual[index]) diffs.push(index);
  }
  if (diffs.length === 0) return null;

  const mora = (index: number): string => moraeText[index] ?? '';
  const expDrop = detectedDropPosition(expected); // 1-based mora before the fall; 0 = none
  const actDrop = detectedDropPosition(actual);

  // 1. Flat — no pitch movement across the word at all, where the accent needs some.
  const actWordUniform = actWord.every((cls) => cls === actWord[0]);
  const expWordUniform = expWord.every((cls) => cls === expWord[0]);
  if (wordLen >= 2 && actWordUniform && !expWordUniform) {
    return {
      kind: 'flat',
      summary: `Your pitch stayed ${
        actWord[0] === 'h' ? 'high' : 'low'
      } across the whole of 「${surfaceForm}」 — its accent needs an audible ${
        expDrop > 0 ? `step down after 「${mora(expDrop - 1)}」` : 'rise after the first mora'
      }.`,
      hint: `Japanese lexical accent is carried almost entirely by pitch height — English marks a word with stress and vowel length instead, so a flat contour is a common transfer. Push the movement past what feels natural: really lift ${
        expDrop > 1 ? `「${mora(expDrop - 1)}」` : 'the high part'
      } and, if there's an accent, drop hard straight after it.`,
    };
  }

  // 2. First mora raised — only atamadaka starts high in Tokyo accent.
  if (wordLen >= 2 && expWord[0] === 'l' && actWord[0] === 'h') {
    return {
      kind: 'first-mora-high',
      summary: `You started 「${surfaceForm}」 high on 「${mora(0)}」; every Tokyo-accent pattern except atamadaka begins low and steps up on the second mora.`,
      hint: `English hits the first syllable of a word hardest, and that pulls the pitch up with it. Start 「${mora(0)}」 deliberately low — almost thrown away — and let the pitch climb onto 「${mora(1)}」.`,
    };
  }

  // 3a. Following particle fell where a heiban word should keep it up.
  if (
    hasFollowing &&
    expected[expected.length - 1] === 'h' &&
    actual[actual.length - 1] === 'l'
  ) {
    const particle = followingText ? `「${followingText}」` : 'the particle after it';
    return {
      kind: 'particle-fall',
      summary: `「${surfaceForm}」 is unaccented (heiban), so ${particle} should stay high — yours dropped, which makes the phrase sound accented.`,
      hint: `English phrases drift downward in pitch, and an unaccented word plus its particle is right where that habit shows. Hold ${particle} up level with the end of 「${surfaceForm}」 — practise it dead flat, even edging up.`,
    };
  }

  // 3a-bis. Odaka: the word's own morae are high to the end and the drop
  // lands on the following particle — learner kept the particle up.
  if (
    hasFollowing &&
    expected[expected.length - 1] === 'l' &&
    actual[actual.length - 1] === 'h' &&
    expWord.every((cls, index) => cls === actWord[index])
  ) {
    const particle = followingText ? `「${followingText}」` : 'the particle after it';
    return {
      kind: 'particle-fall',
      summary: `「${surfaceForm}」 is odaka — its accent is on the very end, so the pitch should fall on ${particle}, not within the word. Yours kept ${particle} up, which sounds unaccented.`,
      hint: `The word itself stays high all the way through; the drop happens the instant ${particle} starts. Say 「${surfaceForm}」 flat and high, then let ${particle} fall away.`,
    };
  }

  // 3b. Word-final mora fell and nothing else did.
  if (
    !hasFollowing &&
    wordLen >= 2 &&
    expWord[wordLen - 1] === 'h' &&
    actWord[wordLen - 1] === 'l' &&
    diffs.every((index) => index === wordLen - 1)
  ) {
    return {
      kind: 'final-fall',
      summary: `The last mora 「${mora(wordLen - 1)}」 of 「${surfaceForm}」 fell away — here it should stay up.`,
      hint: `English lets the end of a word trail downward. Over-correct for it: say 「${mora(
        wordLen - 1,
      )}」 noticeably high, higher than feels right, and hold it there.`,
    };
  }

  // 4. Drop came late / never came, but everything before the real drop matched.
  if (expDrop > 0 && (actDrop === 0 || actDrop > expDrop)) {
    const beforeDropMatches = expWord
      .slice(0, expDrop)
      .every((cls, index) => cls === actWord[index]);
    if (beforeDropMatches) {
      if (actDrop === 0) {
        return {
          kind: 'no-downstep',
          summary: `There's an accent on 「${surfaceForm}」 — the pitch should fall right after 「${mora(
            expDrop - 1,
          )}」 — but yours stayed up to the end, so it sounds heiban.`,
          hint: `Make the downstep after 「${mora(
            expDrop - 1,
          )}」 sharp and definite — a small step down, not a slope. A half-hearted dip reads as no accent at all.`,
        };
      }
      return {
        kind: 'held-high',
        summary: `You held the high pitch past the accent on 「${surfaceForm}」: the drop belongs right after 「${mora(
          expDrop - 1,
        )}」, but your voice stayed up through 「${moraeText.slice(expDrop, actDrop).join('・')}」.`,
        hint: `Treat 「${mora(
          expDrop - 1,
        )}」 as the peak and let the very next mora fall away at once. The plateau tends to stretch when you're concentrating on the word — try it slightly faster so the drop stays crisp.`,
      };
    }
  }

  // 5. Drop came early — pitch sagged before the accent.
  if (expDrop > 0 && actDrop > 0 && actDrop < expDrop) {
    return {
      kind: 'early-drop',
      summary: `The pitch on 「${surfaceForm}」 came down early, after 「${mora(
        actDrop - 1,
      )}」; it should stay up all the way through 「${mora(expDrop - 1)}」.`,
      hint: `Keep 「${mora(0)}」 through 「${mora(
        expDrop - 1,
      )}」 as one connected high plateau — don't let it sag in the middle before the real drop.`,
    };
  }

  // 6. Fallback — divergence that doesn't fit a named mode.
  const diffNames = diffs
    .map((index) => (index < wordLen ? mora(index) : followingText ?? 'the particle'))
    .filter(Boolean)
    .map((name) => `「${name}」`)
    .join(', ');
  return {
    kind: 'generic',
    summary: `Your contour for 「${surfaceForm}」 differs from the dictionary${
      diffNames ? ` at ${diffNames}` : ''
    }.`,
    hint: 'Compare the two rows mark by mark and record it again, matching each one.',
  };
}
