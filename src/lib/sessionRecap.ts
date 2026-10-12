import type { PlannerStepStatus, SessionBucket } from '../domain/types';
import { SESSION_STEP_CATEGORY_ORDER, type SessionStepCategory } from './sessionStepCategory';

/**
 * "What today's session actually moved" — a short honest recap shown in the
 * SessionRunnerPage once the day's session is settled. Complements the
 * always-on `/progress` screen: that one is the long aggregate, this is
 * just-now.
 *
 * Pure, no Dexie/network — same convention as `progressReport.ts` /
 * `pronunciationProfile.ts`. `src/db/repository.ts#getSessionRecap` does the
 * only fetching. Every number is recomputed from evidence
 * (`Review` / `StudyItem` / `SentenceAnalysis` rows) already logged; nothing
 * is seeded or stored.
 *
 * Deliberately narrow (per the user's pick): activities done, reviews graded
 * + accuracy, new vocab introduced today, grammar patterns noticed today.
 * Not shadowing attempts.
 */

export interface SessionRecapReviewInput {
  studyItemId: string;
  timestamp: string;
  rating: 'again' | 'hard' | 'good' | 'easy';
  source?: 'scheduled_review' | 'natural_encounter';
}

export interface SessionRecapStudyItemInput {
  /** Study-item id, to join `SessionRecapReviewInput.studyItemId`. */
  id: string;
  subjectId: string;
  subjectType: string;
}

export interface SessionRecapStepInput {
  bucket: SessionBucket;
  status: PlannerStepStatus;
  /** Learner-facing kind (`sessionStepCategory`); absent → derived from `bucket`. */
  category?: SessionStepCategory;
  /** `'game'` steps are counted on their own line, not under their (nominal) bucket. */
  targetKind?: string;
}

export interface SessionRecapInput {
  /** Session window: `[windowStart, windowEnd]`, inclusive. */
  windowStart: string;
  windowEnd: string;
  steps: SessionRecapStepInput[];
  /** Every review row (the builder windows them itself). */
  reviews: SessionRecapReviewInput[];
  /** Every vocabulary-subject study item (the builder finds first-review-in-window). */
  vocabularyStudyItems: SessionRecapStudyItemInput[];
  /** Count of sentences whose grammar was marked `confirmed` within the window. */
  grammarNoticed: number;
}

export interface SessionRecapCategoryLine {
  category: SessionStepCategory;
  completed: number;
  total: number;
}

export interface SessionRecap {
  activitiesCompleted: number;
  activitiesTotal: number;
  byCategory: SessionRecapCategoryLine[];
  /** Game-break steps (`targetKind: 'game'`) — kept out of `byCategory` and the activity totals. */
  games: { completed: number; total: number };
  reviews: {
    /** Scheduled reviews graded within the window (natural encounters excluded). */
    graded: number;
    /** …rated anything other than "Again". */
    recalled: number;
    /** `recalled / graded`, or null when nothing was graded. */
    accuracy: number | null;
  };
  /** Distinct vocabulary items whose first review of any activity landed in the window. */
  newWords: number;
  grammarNoticed: number;
  /** True when nothing measurable happened — the recap can then be hidden. */
  isEmpty: boolean;
}

const BUCKET_CATEGORY: Record<SessionBucket, SessionStepCategory> = {
  glossing: 'learn_sentence',
  grammar: 'grammar',
  shadowing: 'shadowing',
  review: 'review',
};

export function buildSessionRecap(input: SessionRecapInput): SessionRecap {
  const { windowStart, windowEnd, steps, reviews, vocabularyStudyItems, grammarNoticed } = input;

  const inWindow = (timestamp: string) => timestamp >= windowStart && timestamp <= windowEnd;

  // --- Activities by category -------------------------------------------------
  const byCategory: SessionRecapCategoryLine[] = [];
  let activitiesCompleted = 0;
  let activitiesTotal = 0;
  const gameSteps = steps.filter((step) => step.targetKind === 'game');
  const workSteps = steps.filter((step) => step.targetKind !== 'game');
  for (const category of SESSION_STEP_CATEGORY_ORDER) {
    const categorySteps = workSteps.filter((step) => (step.category ?? BUCKET_CATEGORY[step.bucket]) === category);
    if (categorySteps.length === 0) continue;
    const completed = categorySteps.filter((step) => step.status === 'completed').length;
    byCategory.push({ category, completed, total: categorySteps.length });
    activitiesCompleted += completed;
    activitiesTotal += categorySteps.length;
  }

  // --- Reviews graded this session ---------------------------------------
  const graded = reviews.filter(
    (review) => review.source !== 'natural_encounter' && inWindow(review.timestamp),
  );
  const recalled = graded.filter((review) => review.rating !== 'again').length;

  // --- New vocabulary introduced this session ---------------------------
  const earliestReviewByStudyItem = new Map<string, string>();
  for (const review of reviews) {
    const current = earliestReviewByStudyItem.get(review.studyItemId);
    if (!current || review.timestamp < current) {
      earliestReviewByStudyItem.set(review.studyItemId, review.timestamp);
    }
  }
  const newWordSubjects = new Set<string>();
  for (const item of vocabularyStudyItems) {
    if (item.subjectType !== 'vocabularyItem') continue;
    const earliest = earliestReviewByStudyItem.get(item.id);
    if (earliest && inWindow(earliest)) newWordSubjects.add(item.subjectId);
  }

  return {
    activitiesCompleted,
    activitiesTotal,
    byCategory,
    games: {
      completed: gameSteps.filter((step) => step.status === 'completed').length,
      total: gameSteps.length,
    },
    reviews: {
      graded: graded.length,
      recalled,
      accuracy: graded.length > 0 ? recalled / graded.length : null,
    },
    newWords: newWordSubjects.size,
    grammarNoticed,
    isEmpty:
      activitiesCompleted === 0 &&
      !gameSteps.some((step) => step.status === 'completed') &&
      graded.length === 0 &&
      newWordSubjects.size === 0 &&
      grammarNoticed === 0,
  };
}
