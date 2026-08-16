import type { AlignmentResult, PhoneAlignment, WordAlignment } from '../domain/types';
import type { TimingObservation } from './timingObservations';

/**
 * Turns raw server-side forced-alignment output (Phase 9, Milestone 2b)
 * into specific, actionable timing feedback — "Your 「っ」 in 「ちょっと」 is
 * much shorter than the reference," not a score (docs/STATUS.md Phase 9,
 * Milestone 3).
 *
 * Deliberately does NOT cross-reference Milestone 1's mora-unit
 * segmentation (`src/lib/mora.ts`, keyed to the sentence's *reading*) —
 * MFA's word tier returns words in their original orthographic form,
 * tokenized by MFA's own tokenizer, which doesn't reliably line up
 * word-for-word with Satori's furigana-word segments. Instead this reads
 * phonetic length directly off the phone tier: MFA marks length with the
 * IPA mark "ː" — a held/geminate consonant (the actual acoustic
 * realization of っ, which has no phone symbol of its own) or a long
 * vowel, distinguishable by a small known vowel-symbol set. No mora
 * alignment, reading, or orthography needed.
 */

// The vowel-phone symbols observed in real japanese_mfa output.
// Anything else is treated as consonant-like (the conservative default —
// gemination is what makes something "shorter/longer than expected", and
// almost everything length-markable that isn't a vowel is a held
// consonant in Japanese).
const VOWEL_PHONE_BASES = new Set(['a', 'i', 'u', 'ɯ', 'e', 'o']);

function isVowelPhoneBase(base: string): boolean {
  return VOWEL_PHONE_BASES.has(base);
}

export interface LongPhone {
  phone: PhoneAlignment;
  kind: 'vowel' | 'consonant';
}

export function findLongPhones(word: WordAlignment): LongPhone[] {
  const long: LongPhone[] = [];
  for (const phone of word.phones) {
    if (!phone.text.endsWith('ː')) continue;
    const base = phone.text.slice(0, -1);
    long.push({ phone, kind: isVowelPhoneBase(base) ? 'vowel' : 'consonant' });
  }
  return long;
}

function isSilence(word: WordAlignment): boolean {
  return !word.text || word.text === '<eps>';
}

export function pairWords(
  reference: WordAlignment[],
  learner: WordAlignment[],
): Array<[WordAlignment, WordAlignment]> {
  const refWords = reference.filter((word) => !isSilence(word));
  const learnerWords = learner.filter((word) => !isSilence(word));

  if (refWords.length === learnerWords.length) {
    return refWords.map((word, index) => [word, learnerWords[index]!]);
  }

  // Count mismatch (an inserted/dropped word) — walk both lists and pair
  // on matching text, skipping unmatched entries, so one mismatch doesn't
  // throw off every pair after it.
  const pairs: Array<[WordAlignment, WordAlignment]> = [];
  let i = 0;
  let j = 0;
  while (i < refWords.length && j < learnerWords.length) {
    if (refWords[i]!.text === learnerWords[j]!.text) {
      pairs.push([refWords[i]!, learnerWords[j]!]);
      i += 1;
      j += 1;
      continue;
    }
    // Look ahead a short distance on each side for a resync point.
    const aheadInLearner = learnerWords
      .slice(j + 1, j + 4)
      .findIndex((word) => word.text === refWords[i]!.text);
    const aheadInRef = refWords
      .slice(i + 1, i + 4)
      .findIndex((word) => word.text === learnerWords[j]!.text);
    if (aheadInLearner !== -1 && (aheadInRef === -1 || aheadInLearner <= aheadInRef)) {
      j += aheadInLearner + 1;
    } else if (aheadInRef !== -1) {
      i += aheadInRef + 1;
    } else {
      i += 1;
      j += 1;
    }
  }
  return pairs;
}

const WORD_DURATION_RATIO_THRESHOLD = 0.35;
const WORD_DURATION_ABS_THRESHOLD_S = 0.05;
const LONG_PHONE_RATIO_LOW = 0.6;
const LONG_PHONE_RATIO_HIGH = 1.6;
const LONG_PHONE_RATIO_HIGH_CONFIDENCE_LOW = 0.4;
const LONG_PHONE_RATIO_HIGH_CONFIDENCE_HIGH = 2.5;
const LONG_PHONE_ABS_THRESHOLD_S = 0.025;
const MIN_PHONE_DURATION_S = 0.01;

function wordDuration(word: WordAlignment): number {
  return word.end - word.start;
}

export function buildWordTimingObservations({
  reference,
  learner,
}: {
  reference: AlignmentResult;
  learner: AlignmentResult;
}): TimingObservation[] {
  const observations: TimingObservation[] = [];
  const pairs = pairWords(reference.words, learner.words);

  pairs.forEach(([refWord, learnerWord], pairIndex) => {
    const refDuration = wordDuration(refWord);
    const learnerDuration = wordDuration(learnerWord);
    const ratio = refDuration > 0 ? learnerDuration / refDuration : 1;
    const absDiff = Math.abs(learnerDuration - refDuration);
    if (
      Math.abs(ratio - 1) > WORD_DURATION_RATIO_THRESHOLD &&
      absDiff > WORD_DURATION_ABS_THRESHOLD_S
    ) {
      observations.push({
        id: `word-duration-${pairIndex}`,
        kind: 'word-duration',
        confidence: 'medium',
        message:
          ratio > 1
            ? `You were slower than the reference during 「${refWord.text}」.`
            : `You were faster than the reference during 「${refWord.text}」.`,
        detail: `Reference ${(refDuration * 1000).toFixed(0)}ms, yours ${(learnerDuration * 1000).toFixed(0)}ms.`,
      });
    }

    const refLong = findLongPhones(refWord);
    const learnerLong = findLongPhones(learnerWord);
    const kinds: Array<'consonant' | 'vowel'> = ['consonant', 'vowel'];
    for (const kind of kinds) {
      const refOfKind = refLong.filter((item) => item.kind === kind);
      const learnerOfKind = learnerLong.filter((item) => item.kind === kind);
      refOfKind.forEach((refItem, kindIndex) => {
        const learnerItem = learnerOfKind[kindIndex];
        const refPhoneDuration = refItem.phone.end - refItem.phone.start;
        const learnerPhoneDuration = learnerItem
          ? learnerItem.phone.end - learnerItem.phone.start
          : MIN_PHONE_DURATION_S;
        const phoneRatio =
          refPhoneDuration > 0 ? learnerPhoneDuration / refPhoneDuration : 1;
        const phoneAbsDiff = Math.abs(learnerPhoneDuration - refPhoneDuration);
        if (
          (phoneRatio < LONG_PHONE_RATIO_LOW || phoneRatio > LONG_PHONE_RATIO_HIGH) &&
          phoneAbsDiff > LONG_PHONE_ABS_THRESHOLD_S
        ) {
          const isStark =
            phoneRatio < LONG_PHONE_RATIO_HIGH_CONFIDENCE_LOW ||
            phoneRatio > LONG_PHONE_RATIO_HIGH_CONFIDENCE_HIGH;
          const confidence = isStark ? 'high' : 'medium';
          const longer = phoneRatio > 1;
          const degree = isStark ? (longer ? 'much longer' : 'much shorter') : longer ? 'longer' : 'shorter';
          observations.push({
            id: `long-phone-${kind}-${pairIndex}-${kindIndex}`,
            kind: kind === 'consonant' ? 'sokuon_timing' : 'long_vowel_timing',
            confidence,
            message:
              kind === 'consonant'
                ? `Your 「っ」 in 「${refWord.text}」 is ${degree} than the reference.`
                : `Your long vowel in 「${refWord.text}」 is ${degree} than the reference.`,
            detail: `Reference ${(refPhoneDuration * 1000).toFixed(0)}ms, yours ${(learnerPhoneDuration * 1000).toFixed(0)}ms.`,
          });
        }
      });
    }
  });

  return observations;
}
