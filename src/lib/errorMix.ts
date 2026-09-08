import type { ErrorClassification } from '../domain/types';
import type { TrendDirection } from './pronunciationProfile';

/**
 * "What to work on" — aggregates `Review.errorClassification` (written by
 * `classifyReviewError`, today only shown as raw JSON on
 * `StudyItemDebugPage`) into an interpretable breakdown of the *kinds* of
 * mistakes the learner keeps making, each paired with a concrete next
 * action rather than a bare count. A `pronunciation` block folds in the
 * shadowing-side signal (`buildShadowingWeakWords` + the pronunciation
 * profile) — production evidence, flagged as such, not a graded miss.
 *
 * Pure, no Dexie/network — same convention as `progressReport.ts`.
 * `src/db/repository.ts#getErrorMix` does the only fetching.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Below this many misses in a category, no trend is claimed. */
export const ERROR_MIX_MIN_TREND_SAMPLES = 4;
/** Relative recent-vs-earlier count change past which a trend is called. */
export const ERROR_MIX_TREND_DELTA = 0.25;

export interface ErrorMixReviewInput {
  timestamp: string;
  rating: 'again' | 'hard' | 'good' | 'easy';
  errorClassification?: ErrorClassification;
}

export interface ErrorMixWeakWord {
  surfaceForm: string;
  issueKind: string;
  attemptCount: number;
  trend: TrendDirection;
}

export interface ErrorMixInput {
  now: Date;
  /** 0 = all time. */
  windowDays: number;
  reviews: ErrorMixReviewInput[];
  weakWords: ErrorMixWeakWord[];
  pronunciationHeadline: string | null;
  pronunciationTopFocus: { label: string; sentenceCount: number; trend: TrendDirection } | null;
}

export interface ErrorCategory {
  /** Stable key — the classification string. */
  key: string;
  label: string;
  count: number;
  /** Share of all *classified* misses in the window. */
  shareOfClassified: number;
  trend: TrendDirection;
  nextAction: string;
  /** In-app route for the action, when there is one. */
  route?: string;
}

export interface ErrorMix {
  hasData: boolean;
  windowDays: number;
  classifiedTotal: number;
  categories: ErrorCategory[];
  /** `again`-rated reviews in the window with no classification (self-rated cards etc.). */
  unclassifiedAgainCount: number;
  pronunciation: {
    headline: string | null;
    topFocusLabel?: string;
    topFocusSentenceCount?: number;
    topFocusTrend?: TrendDirection;
    weakWords: ErrorMixWeakWord[];
  } | null;
}

function classificationKey(classification: ErrorClassification): string {
  return typeof classification === 'string' ? classification : classification.userDefined;
}

const META: Record<string, { label: string; nextAction: string; route?: string }> = {
  incorrect_reading: {
    label: 'Wrong reading',
    nextAction: 'Drill readings',
    route: '/review',
  },
  kanji_reading_interference: {
    label: 'Kanji reading interference',
    nextAction: 'Drill readings in context',
    route: '/review',
  },
  incorrect_meaning: {
    label: 'Wrong meaning',
    nextAction: 'Re-read these in context',
  },
  vocabulary_confusion: {
    label: 'Confused two words',
    nextAction: 'Contrastive pairs',
    route: '/review',
  },
  grammar_misunderstanding: {
    label: 'Grammar / conjugation',
    nextAction: 'Review grammar',
    route: '/grammar',
  },
  pronunciation_difficulty: {
    label: 'Pitch accent',
    nextAction: 'Pitch-accent drill',
    route: '/pitch-accent',
  },
  listening_failure: {
    label: 'Missed it by ear',
    nextAction: 'More listening + shadowing',
  },
};

function metaFor(key: string): { label: string; nextAction: string; route?: string } {
  return META[key] ?? { label: key, nextAction: 'Review these' };
}

function countTrend(timestamps: string[], windowStartMs: number, nowMs: number): TrendDirection {
  if (timestamps.length < ERROR_MIX_MIN_TREND_SAMPLES) return 'insufficient_data';
  const midpoint = windowStartMs + (nowMs - windowStartMs) / 2;
  let earlier = 0;
  let recent = 0;
  for (const timestamp of timestamps) {
    if (new Date(timestamp).getTime() < midpoint) earlier += 1;
    else recent += 1;
  }
  const delta = (recent - earlier) / Math.max(1, earlier);
  if (delta >= ERROR_MIX_TREND_DELTA) return 'worsening';
  if (delta <= -ERROR_MIX_TREND_DELTA) return 'improving';
  return 'steady';
}

export function buildErrorMix(input: ErrorMixInput): ErrorMix {
  const nowMs = input.now.getTime();
  const cutoffMs = input.windowDays > 0 ? nowMs - input.windowDays * MS_PER_DAY : 0;
  const inWindow = input.reviews.filter(
    (review) => new Date(review.timestamp).getTime() >= cutoffMs,
  );

  const windowStartMs =
    input.windowDays > 0
      ? cutoffMs
      : Math.min(
          nowMs,
          ...inWindow.map((review) => new Date(review.timestamp).getTime()),
        );

  const timestampsByKey = new Map<string, string[]>();
  let unclassifiedAgainCount = 0;
  for (const review of inWindow) {
    if (review.errorClassification) {
      const key = classificationKey(review.errorClassification);
      const list = timestampsByKey.get(key) ?? [];
      list.push(review.timestamp);
      timestampsByKey.set(key, list);
    } else if (review.rating === 'again') {
      unclassifiedAgainCount += 1;
    }
  }

  const classifiedTotal = [...timestampsByKey.values()].reduce(
    (sum, list) => sum + list.length,
    0,
  );

  const categories: ErrorCategory[] = [...timestampsByKey.entries()]
    .map(([key, timestamps]) => {
      const meta = metaFor(key);
      return {
        key,
        label: meta.label,
        count: timestamps.length,
        shareOfClassified: classifiedTotal > 0 ? timestamps.length / classifiedTotal : 0,
        trend: countTrend(timestamps, windowStartMs, nowMs),
        nextAction: meta.nextAction,
        route: meta.route,
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const pronunciation =
    input.pronunciationHeadline || input.pronunciationTopFocus || input.weakWords.length > 0
      ? {
          headline: input.pronunciationHeadline,
          topFocusLabel: input.pronunciationTopFocus?.label,
          topFocusSentenceCount: input.pronunciationTopFocus?.sentenceCount,
          topFocusTrend: input.pronunciationTopFocus?.trend,
          weakWords: input.weakWords.slice(0, 8),
        }
      : null;

  return {
    hasData: classifiedTotal > 0 || unclassifiedAgainCount > 0 || pronunciation !== null,
    windowDays: input.windowDays,
    classifiedTotal,
    categories,
    unclassifiedAgainCount,
    pronunciation,
  };
}
