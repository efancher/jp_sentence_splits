import { MATURE_MIN_SCHEDULED_DAYS } from './maturity';
import type { TrendDirection } from './pronunciationProfile';
import { isVocabularyItemProficient } from './scheduling';

/**
 * "How am I doing" progress report (docs/ROADMAP.md — "Retention /
 * progress-over-time view"). One honest aggregate screen built purely from
 * evidence already logged (`Review` rows + `StudyItem` FSRS state + the
 * shadowing analysis summaries), so there is nothing to seed or maintain.
 *
 * Pure, no Dexie/network — same convention as `pronunciationProfile.ts` /
 * `maturity.ts`, so every number is inspectable and unit-tested without a
 * browser. `src/db/repository.ts#getProgressReport` does the only fetching.
 *
 * Deliberately minimal: a handful of interpretable counts, an FSRS
 * pass-rate, and a per-week activity/vocabulary trend — no precise
 * retention model, no per-activity breakdown (dedicated diagnostic views
 * have been declined before — see the ROADMAP note).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_WINDOW_DAYS = 30;
const DEFAULT_WEEKS = 8;

export interface ProgressReviewInput {
  studyItemId: string;
  timestamp: string;
  rating: 'again' | 'hard' | 'good' | 'easy';
  source?: 'scheduled_review' | 'natural_encounter';
}

export interface ProgressStudyItemInput {
  subjectId: string;
  subjectType: string;
  activityType: string;
  createdAt: string;
  state: 'new' | 'learning' | 'review' | 'relearning';
  scheduledDays: number;
  /** Study-item id, to join `ProgressReviewInput.studyItemId`. */
  id: string;
}

export interface ProgressReportInput {
  now: Date;
  reviews: ProgressReviewInput[];
  studyItems: ProgressStudyItemInput[];
  shadowing: ShadowingProgress;
  retentionWindowDays?: number;
  weeks?: number;
}

export interface ShadowingProgress {
  attemptsAnalyzed: number;
  sentencesPracticed: number;
  timingTrend: TrendDirection;
  pitchTrend: TrendDirection;
}

export interface WeekBucket {
  /** ISO date (UTC) of the Monday that starts the week. */
  weekStart: string;
  reviews: number;
  wordsLearned: number;
  cumulativeWordsLearned: number;
}

export interface ProgressReport {
  generatedAt: string;
  hasData: boolean;
  vocabulary: {
    /** Distinct vocabulary items with any study item. */
    tracked: number;
    /** …that have reached FSRS `review`/`relearning` on at least one activity. */
    proficient: number;
    /** …that also hold a long ("mature") interval on every seeded activity. */
    mature: number;
    /** …first recalled within the retention window. */
    learnedInWindow: number;
  };
  grammar: {
    tracked: number;
    /** Tracked patterns whose `grammar_comprehension` card is FSRS-proficient. */
    recognized: number;
  };
  retention: {
    windowDays: number;
    /** Scheduled reviews (natural encounters excluded) in the window. */
    scheduledReviews: number;
    /** …that passed (any rating other than "Again"). */
    recalled: number;
    windowRate: number | null;
    allTimeRate: number | null;
  };
  shadowing: ShadowingProgress;
  weeks: WeekBucket[];
}

/** Monday 00:00 UTC of the week containing `date`, as `YYYY-MM-DD`. */
export function startOfWeekUtc(date: Date): string {
  const utc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayOfWeek = utc.getUTCDay(); // 0 = Sunday
  const daysFromMonday = (dayOfWeek + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - daysFromMonday);
  return utc.toISOString().slice(0, 10);
}

function isScheduled(review: ProgressReviewInput): boolean {
  return review.source !== 'natural_encounter';
}

function rate(passed: number, total: number): number | null {
  return total > 0 ? passed / total : null;
}

export function buildProgressReport(input: ProgressReportInput): ProgressReport {
  const {
    now,
    reviews,
    studyItems,
    shadowing,
    retentionWindowDays = DEFAULT_RETENTION_WINDOW_DAYS,
    weeks = DEFAULT_WEEKS,
  } = input;

  const reviewsByStudyItem = new Map<string, ProgressReviewInput[]>();
  for (const review of reviews) {
    const list = reviewsByStudyItem.get(review.studyItemId) ?? [];
    list.push(review);
    reviewsByStudyItem.set(review.studyItemId, list);
  }

  // --- Vocabulary ladder -------------------------------------------------
  const vocabItemsBySubject = new Map<string, ProgressStudyItemInput[]>();
  for (const item of studyItems) {
    if (item.subjectType !== 'vocabularyItem') continue;
    const list = vocabItemsBySubject.get(item.subjectId) ?? [];
    list.push(item);
    vocabItemsBySubject.set(item.subjectId, list);
  }

  const windowCutoff = now.getTime() - retentionWindowDays * MS_PER_DAY;
  let proficient = 0;
  let mature = 0;
  let learnedInWindow = 0;
  /** subjectId -> earliest "recalled it" timestamp, for the weekly trend. */
  const wordLearnedAt = new Map<string, string>();

  for (const [subjectId, items] of vocabItemsBySubject) {
    const isProficient = items.some((item) => isVocabularyItemProficient(item.state));
    if (!isProficient) continue;
    proficient += 1;
    if (items.every((item) => item.state === 'review' && item.scheduledDays >= MATURE_MIN_SCHEDULED_DAYS)) {
      mature += 1;
    }
    // "Learned" moment: the earliest passing review across this word's
    // activities, falling back to its earliest review of any rating, then
    // to when its card was created.
    let learnedAt: string | undefined;
    for (const item of items) {
      const itemReviews = reviewsByStudyItem.get(item.id) ?? [];
      const passing = itemReviews
        .filter((review) => review.rating !== 'again')
        .map((review) => review.timestamp)
        .sort();
      const any = itemReviews.map((review) => review.timestamp).sort();
      const candidate = passing[0] ?? any[0] ?? item.createdAt;
      if (!learnedAt || candidate < learnedAt) learnedAt = candidate;
    }
    if (learnedAt) {
      wordLearnedAt.set(subjectId, learnedAt);
      if (new Date(learnedAt).getTime() >= windowCutoff) learnedInWindow += 1;
    }
  }

  // --- Grammar ---------------------------------------------------------
  const grammarSubjects = new Set<string>();
  const grammarRecognized = new Set<string>();
  for (const item of studyItems) {
    if (item.subjectType !== 'grammarPattern') continue;
    grammarSubjects.add(item.subjectId);
    if (
      item.activityType === 'grammar_comprehension' &&
      isVocabularyItemProficient(item.state)
    ) {
      grammarRecognized.add(item.subjectId);
    }
  }

  // --- Retention (FSRS pass rate) -------------------------------------
  const scheduled = reviews.filter(isScheduled);
  const windowScheduled = scheduled.filter(
    (review) => new Date(review.timestamp).getTime() >= windowCutoff,
  );
  const passed = (list: ProgressReviewInput[]) =>
    list.filter((review) => review.rating !== 'again').length;

  // --- Weekly trend --------------------------------------------------
  const weekStarts: string[] = [];
  const cursor = new Date(`${startOfWeekUtc(now)}T00:00:00.000Z`);
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const week = new Date(cursor.getTime() - i * 7 * MS_PER_DAY);
    weekStarts.push(week.toISOString().slice(0, 10));
  }
  const firstWeekStart = weekStarts[0]!;

  const reviewsPerWeek = new Map<string, number>();
  for (const review of reviews) {
    const week = startOfWeekUtc(new Date(review.timestamp));
    reviewsPerWeek.set(week, (reviewsPerWeek.get(week) ?? 0) + 1);
  }
  const learnedPerWeek = new Map<string, number>();
  let learnedBeforeWindow = 0;
  for (const learnedAt of wordLearnedAt.values()) {
    const week = startOfWeekUtc(new Date(learnedAt));
    if (week < firstWeekStart) {
      learnedBeforeWindow += 1;
      continue;
    }
    learnedPerWeek.set(week, (learnedPerWeek.get(week) ?? 0) + 1);
  }

  let cumulative = learnedBeforeWindow;
  const weekBuckets: WeekBucket[] = weekStarts.map((weekStart) => {
    const wordsLearned = learnedPerWeek.get(weekStart) ?? 0;
    cumulative += wordsLearned;
    return {
      weekStart,
      reviews: reviewsPerWeek.get(weekStart) ?? 0,
      wordsLearned,
      cumulativeWordsLearned: cumulative,
    };
  });

  return {
    generatedAt: now.toISOString(),
    hasData: reviews.length > 0 || studyItems.length > 0,
    vocabulary: {
      tracked: vocabItemsBySubject.size,
      proficient,
      mature,
      learnedInWindow,
    },
    grammar: {
      tracked: grammarSubjects.size,
      recognized: grammarRecognized.size,
    },
    retention: {
      windowDays: retentionWindowDays,
      scheduledReviews: windowScheduled.length,
      recalled: passed(windowScheduled),
      windowRate: rate(passed(windowScheduled), windowScheduled.length),
      allTimeRate: rate(passed(scheduled), scheduled.length),
    },
    shadowing,
    weeks: weekBuckets,
  };
}
