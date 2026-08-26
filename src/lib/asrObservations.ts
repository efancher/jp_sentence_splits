import type { TimingObservation } from './timingObservations';
import type { WordAlignment } from '../domain/types';
import { displayWordText } from './wordTimingObservations';

/**
 * Turns a secondary, non-authoritative ASR signal (Phase 9, Milestone 7)
 * into hedged "possible difference" hints — never a claim that the
 * learner mispronounced something, per the brief's explicit instruction:
 * ASR is not ground truth, since the expected transcript is already
 * known and more reliable than an open-vocabulary recognizer's guess.
 *
 * Diffs the ASR text against the reference alignment's own word texts
 * concatenated (not the raw sentence string — guarantees exact
 * character-offset correspondence to the word list; the raw sentence can
 * contain punctuation the alignment doesn't carry) using a small LCS-based
 * character diff — these are short strings (~10-30 characters), no need
 * for a diff library.
 */

const NORMALIZE_PATTERN = /[\s、。！？「」]/g;

function normalize(text: string): string {
  return text.replace(NORMALIZE_PATTERN, '');
}

/** For each character in `a`, whether it participates in the LCS with `b`. */
function lcsMatchMask(a: string, b: string): boolean[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      dp[i]![j] =
        a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const matched = new Array<boolean>(n).fill(false);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      matched[i - 1] = true;
      i -= 1;
      j -= 1;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return matched;
}

const ASR_OBSERVATION_SEVERITY = 0.25;

export function buildAsrObservations({
  referenceWords,
  transcribedText,
}: {
  referenceWords: WordAlignment[];
  transcribedText: string;
}): TimingObservation[] {
  const audibleWords = referenceWords.filter((word) => word.text && word.text !== '<eps>');
  const referenceText = audibleWords.map((word) => word.text).join('');
  const normalizedReference = normalize(referenceText);
  const normalizedTranscribed = normalize(transcribedText);
  if (normalizedReference.length === 0) return [];
  if (normalizedReference === normalizedTranscribed) return [];

  // Match against the *normalized* reference, but we need offsets into
  // the *original* (unnormalized) referenceText to map back to words —
  // track which original index each normalized character came from.
  const originalIndexOfNormalizedChar: number[] = [];
  for (let index = 0; index < referenceText.length; index += 1) {
    if (!NORMALIZE_PATTERN.test(referenceText[index]!)) {
      originalIndexOfNormalizedChar.push(index);
    }
  }
  NORMALIZE_PATTERN.lastIndex = 0;

  const matched = lcsMatchMask(normalizedReference, normalizedTranscribed);

  const wordBoundaries: Array<{ word: WordAlignment; start: number; end: number }> = [];
  let cursor = 0;
  for (const word of audibleWords) {
    wordBoundaries.push({ word, start: cursor, end: cursor + word.text.length });
    cursor += word.text.length;
  }

  const affectedWords = new Set<WordAlignment>();
  matched.forEach((isMatched, normalizedIndex) => {
    if (isMatched) return;
    const originalIndex = originalIndexOfNormalizedChar[normalizedIndex];
    if (originalIndex === undefined) return;
    const boundary = wordBoundaries.find((b) => originalIndex >= b.start && originalIndex < b.end);
    if (boundary) affectedWords.add(boundary.word);
  });

  return Array.from(affectedWords).map((word, index) => ({
    id: `asr-diagnostic-${index}`,
    kind: 'asr_diagnostic',
    confidence: 'low',
    severity: ASR_OBSERVATION_SEVERITY,
    segment: { startMs: word.start * 1000, endMs: word.end * 1000 },
    message: `Possible pronunciation difference around 「${displayWordText(word.text)}」.`,
    detail: `Heard: 「${transcribedText}」`,
  }));
}
