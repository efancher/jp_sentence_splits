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

/** Why an item is interesting to label, for the "why this item" chip. */
export function labelReason(
  estimates: WordBoundaryEstimates,
  sampleKind: 'random' | 'targeted',
): string {
  if (sampleKind === 'random') return estimates.unreliable ? 'Random sample — timing flagged unreliable here' : 'Random sample';
  if (estimates.unreliable) return 'Timing looks unreliable here (squashed speech nearby)';
  const gap = Math.round(estimatorDisagreementMs(estimates));
  const mora = estimates.mora;
  if (mora && mora.endMs - mora.startMs < 250) return `Very short mora cut (${Math.round(mora.endMs - mora.startMs)} ms)`;
  return gap > 0 ? `Token vs mora cut differ by ${gap} ms` : 'Selected for review';
}

export interface QueueCandidate {
  linkId: string;
  bookId?: string;
  estimates: WordBoundaryEstimates;
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

/**
 * Picks which candidates to label.
 *  - `random`: an unbiased sample spread across books — shuffle within each
 *    book, then take round-robin, so a big book can't crowd out the rest (the
 *    book is the speaker proxy). Use these for measuring error.
 *  - `targeted`: the items where the estimators disagree most, plus very short
 *    mora cuts — the cases most likely to be wrong. Use these for calibration
 *    only; they are a biased sample.
 */
export function pickLabelQueue<T extends QueueCandidate>(
  candidates: readonly T[],
  mode: 'random' | 'targeted',
  size = LABEL_SESSION_SIZE,
  rand: () => number = Math.random,
): T[] {
  const usable = candidates.filter((c) => startingSpan(c.estimates));
  if (mode === 'targeted') {
    const score = (c: T) => {
      const mora = c.estimates.mora;
      const short = mora && mora.endMs - mora.startMs < 250 ? 150 : 0;
      // Guard-flagged items first: labelling them is how the guard gets checked.
      const flagged = c.estimates.unreliable ? 5000 : 0;
      return estimatorDisagreementMs(c.estimates) + short + flagged;
    };
    return [...usable]
      .filter((c) => score(c) > 0)
      .sort((a, b) => score(b) - score(a))
      .slice(0, size);
  }
  const byBook = new Map<string, T[]>();
  for (const c of shuffled(usable, rand)) {
    const key = c.bookId ?? '(none)';
    byBook.set(key, [...(byBook.get(key) ?? []), c]);
  }
  const lanes = shuffled([...byBook.values()], rand);
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
