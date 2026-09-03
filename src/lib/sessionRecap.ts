import type { PlannerStepStatus, SessionBucket } from '../domain/types';

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

export interface SessionRecapBucketLine {
  bucket: SessionBucket;
  completed: number;
  total: number;
}

export interface SessionRecap {
  activitiesCompleted: number;
  activitiesTotal: number;
  byBucket: SessionRecapBucketLine[];
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

const BUCKET_ORDER: SessionBucket[] = ['glossing', 'grammar', 'shadowing', 'review'];

export function buildSessionRecap(input: SessionRecapInput): SessionRecap {
  const { windowStart, windowEnd, steps, reviews, vocabularyStudyItems, grammarNoticed } = input;

  const inWindow = (timestamp: string) => timestamp >= windowStart && timestamp <= windowEnd;

  // --- Activities by bucket -------------------------------------------------
  const byBucket: SessionRecapBucketLine[] = [];
  let activitiesCompleted = 0;
  let activitiesTotal = 0;
  for (const bucket of BUCKET_ORDER) {
    const bucketSteps = steps.filter((step) => step.bucket === bucket);
    if (bucketSteps.length === 0) continue;
    const completed = bucketSteps.filter((step) => step.status === 'completed').length;
    byBucket.push({ bucket, completed, total: bucketSteps.length });
    activitiesCompleted += completed;
    activitiesTotal += bucketSteps.length;
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
    byBucket,
    reviews: {
      graded: graded.length,
      recalled,
      accuracy: graded.length > 0 ? recalled / graded.length : null,
    },
    newWords: newWordSubjects.size,
    grammarNoticed,
    isEmpty:
      activitiesCompleted === 0 &&
      graded.length === 0 &&
      newWordSubjects.size === 0 &&
      grammarNoticed === 0,
  };
}
