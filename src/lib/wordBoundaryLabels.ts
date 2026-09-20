import type {
  WordAlignment,
  WordBoundaryEstimates,
  WordBoundaryLabel,
  WordBoundarySpan,
} from '../domain/types';

import { isolatedWordMatchRange, isolatedWordSpans, wordTimingUnreliable } from './isolatedWordRange';

/**
 * Pure logic for the word-boundary labelling tool (`/label-word-audio`,
 * docs/ROADMAP.md "Word-audio ground truth"): what each estimator says about a
 * target word, how to pick which items to label, and how to score the
 * estimators against the labels afterwards.
 */

/**
 * Bump when `isolatedWordRange`'s output changes materially (matching, mora cut,
 * pad). Stored on every label so old labels stay interpretable — the auto spans
 * drift as the code changes, so error must be computed against the estimates
 * that were *shown*, not recomputed later.
 */
export const WORD_SPAN_VERSION = '2026-09-20.5';

/** Default labelling session length. */
export const LABEL_SESSION_SIZE = 25;

const toSpan = (range: { startMs: number; endMs: number } | null): WordBoundarySpan | null =>
  range ? { startMs: range.startMs, endMs: range.endMs } : null;

/** Every estimator's unpadded span for the target, from one cached alignment. */
export function estimateWordSpans(
  words: WordAlignment[],
  japanese: string,
  inlineReading: string | undefined,
  surfaceForm: string,
): WordBoundaryEstimates {
  const reading = { inlineReading };
  // The labelling tool must still see items the squashed-alignment guard rejects —
  // they are exactly the ones needed to check the guard — so the raw estimators
  // ask for them; `shipped` stays what the app really plays (null when flagged).
  const keep = { includeUnreliable: true };
  return {
    token: toSpan(isolatedWordMatchRange(words, japanese, surfaceForm, undefined, keep)),
    mora: toSpan(isolatedWordMatchRange(words, japanese, surfaceForm, reading, keep)),
    shipped: toSpan(isolatedWordSpans(words, japanese, surfaceForm, reading)?.wordOnly ?? null),
    unreliable: wordTimingUnreliable(words, japanese, surfaceForm),
  };
}

/** Where the labelling handles start: the best estimate of the word itself (mora cut, else token). */
export function startingSpan(estimates: WordBoundaryEstimates): WordBoundarySpan | null {
  return estimates.mora ?? estimates.token;
}

/** How far apart the token and mora estimators are — the widest edge gap, ms. 0 when they agree or only one exists. */
export function estimatorDisagreementMs(estimates: WordBoundaryEstimates): number {
  const { token, mora } = estimates;
  if (!token || !mora) return 0;
  return Math.max(Math.abs(token.startMs - mora.startMs), Math.abs(token.endMs - mora.endMs));
}

/** Why an item is in the batch, for the "why this item" chip. */
export function labelReason(
  estimates: WordBoundaryEstimates,
  sampleKind: 'random' | 'targeted',
  stratum?: LabelStratum,
): string {
  if (sampleKind === 'targeted' && stratum && stratum !== 'plain') return `Sampled from: ${STRATUM_LABELS[stratum]}`;
  if (estimates.unreliable) return 'Random sample — timing flagged unreliable here';
  return 'Random sample';
}

/**
 * The situations the targeted sample draws from. Each is a way the automatic cut
 * is known or suspected to go wrong; every item falls in exactly one (first
 * match wins, in this order), and everything else is `plain` — covered by the
 * plain random sample instead.
 */
export type LabelStratum =
  | 'unreliable-timing' // the squashed-alignment guard flagged it
  | 'mid-token' // the target ends inside an aligner token (token and mora cut differ)
  | 'very-short' // the mora cut is under 250 ms
  | 'repeated-word' // the surface form occurs more than once in the sentence
  | 'digits-or-latin' // digits or Latin letters in the sentence (numeral expansion, `VIP`)
  | 'plain';

export const STRATUM_LABELS: Record<LabelStratum, string> = {
  'unreliable-timing': 'timing flagged unreliable (squashed speech nearby)',
  'mid-token': 'target ends inside a longer aligner token',
  'very-short': 'very short word (under 250 ms)',
  'repeated-word': 'word appears twice in the sentence',
  'digits-or-latin': 'digits or Latin letters in the sentence',
  plain: 'no special situation',
};

export interface QueueCandidate {
  linkId: string;
  bookId?: string;
  /** For the text-based strata (repeated word, digits/Latin); optional so bare candidates still work. */
  japanese?: string;
  surfaceForm?: string;
  estimates: WordBoundaryEstimates;
}

const DIGITS_OR_LATIN = /[0-9０-９A-Za-zＡ-Ｚａ-ｚ]/;

export function stratumOf(c: QueueCandidate): LabelStratum {
  const { token, mora } = c.estimates;
  if (c.estimates.unreliable) return 'unreliable-timing';
  if (token && mora && Math.abs(token.endMs - mora.endMs) + Math.abs(token.startMs - mora.startMs) >= 30) return 'mid-token';
  if (mora && mora.endMs - mora.startMs < 250) return 'very-short';
  if (c.japanese && c.surfaceForm) {
    const first = c.japanese.indexOf(c.surfaceForm);
    if (first >= 0 && c.japanese.indexOf(c.surfaceForm, first + 1) >= 0) return 'repeated-word';
  }
  if (c.japanese && DIGITS_OR_LATIN.test(c.japanese)) return 'digits-or-latin';
  return 'plain';
}

/** Items per stratum in a pool, for weighting a stratified sample back to the whole. */
export function stratumCounts(candidates: readonly QueueCandidate[]): Record<LabelStratum, number> {
  const counts: Record<LabelStratum, number> = {
    'unreliable-timing': 0, 'mid-token': 0, 'very-short': 0, 'repeated-word': 0, 'digits-or-latin': 0, plain: 0,
  };
  for (const c of candidates) counts[stratumOf(c)] += 1;
  return counts;
}

/** Fisher–Yates with an injectable PRNG (tests pass a seeded one). */
function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Takes items round-robin from shuffled lanes until `size` are chosen or the lanes run dry. */
function roundRobin<T>(lanes: readonly (readonly T[])[], size: number): T[] {
  const out: T[] = [];
  for (let round = 0; out.length < size; round += 1) {
    let took = false;
    for (const lane of lanes) {
      const next = lane[round];
      if (next) {
        out.push(next);
        took = true;
        if (out.length >= size) break;
      }
    }
    if (!took) break;
  }
  return out;
}

/**
 * Picks which candidates to label. Both modes are *randomised* — nothing is
 * chosen because it looked wrong (a hand-picked worst-first list is a biased
 * sample that can't be generalised from):
 *  - `random`: spread across books — shuffle within each book, then round-robin,
 *    so a big book can't crowd out the rest (the book is the speaker proxy).
 *    Measures overall accuracy.
 *  - `targeted`: random within the situations we want to check
 *    (`LabelStratum`, everything but `plain`), equal allocation across the
 *    situations present so a rare one (flagged timing) still gets sampled.
 *    Measures accuracy *per situation*; each label records its situation and
 *    how common that situation was in the pool so results can be re-weighted.
 */
export function pickLabelQueue<T extends QueueCandidate>(
  candidates: readonly T[],
  mode: 'random' | 'targeted',
  size = LABEL_SESSION_SIZE,
  rand: () => number = Math.random,
): T[] {
  const usable = candidates.filter((c) => startingSpan(c.estimates));
  if (mode === 'targeted') {
    const byStratum = new Map<LabelStratum, T[]>();
    for (const c of usable) {
      const stratum = stratumOf(c);
      if (stratum === 'plain') continue;
      byStratum.set(stratum, [...(byStratum.get(stratum) ?? []), c]);
    }
    return roundRobin(shuffled([...byStratum.values()].map((lane) => shuffled(lane, rand)), rand), size);
  }
  const byBook = new Map<string, T[]>();
  for (const c of shuffled(usable, rand)) {
    const key = c.bookId ?? '(none)';
    byBook.set(key, [...(byBook.get(key) ?? []), c]);
  }
  return roundRobin(shuffled([...byBook.values()], rand), size);
}

export type EstimatorName = 'shown' | 'token' | 'mora' | 'shipped';

export interface EdgeErrors {
  /** estimator − label, ms; positive = the estimator's edge is later than the label. */
  start: number[];
  end: number[];
}

/**
 * Signed edge errors of an estimator against the hand labels (skipped items
 * excluded; a `clean` label equals what was shown). `shipped` includes the
 * pad, so compare it against the padded expectation, not the strict word.
 */
export function edgeErrors(
  labels: readonly WordBoundaryLabel[],
  estimator: EstimatorName,
  filter: (label: WordBoundaryLabel) => boolean = () => true,
): EdgeErrors {
  const out: EdgeErrors = { start: [], end: [] };
  for (const l of labels) {
    if (l.verdict === 'skipped' || !l.label || !filter(l)) continue;
    const estimate = estimator === 'shown' ? l.shown : l.estimates[estimator];
    if (!estimate) continue;
    out.start.push(estimate.startMs - l.label.startMs);
    out.end.push(estimate.endMs - l.label.endMs);
  }
  return out;
}

/** Linear-interpolated percentile (p in 0..1) of `values`; NaN when empty. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

export interface ErrorSummary {
  n: number;
  /** Median signed error — a systematic early/late bias. */
  medianMs: number;
  /** Median / 90th percentile of the absolute error. */
  medianAbsMs: number;
  p90AbsMs: number;
  /** Share of edges within 25 / 50 ms. */
  within25: number;
  within50: number;
}

export function summarizeErrors(errors: readonly number[]): ErrorSummary {
  const abs = errors.map(Math.abs);
  const share = (limit: number) => (abs.length ? abs.filter((e) => e <= limit).length / abs.length : Number.NaN);
  return {
    n: errors.length,
    medianMs: percentile(errors, 0.5),
    medianAbsMs: percentile(abs, 0.5),
    p90AbsMs: percentile(abs, 0.9),
    within25: share(25),
    within50: share(50),
  };
}

/** True when the labelled edges differ from the shown ones (beyond rounding). */
export function edgesMoved(shown: WordBoundarySpan, current: WordBoundarySpan): boolean {
  return Math.abs(shown.startMs - current.startMs) >= 1 || Math.abs(shown.endMs - current.endMs) >= 1;
}
