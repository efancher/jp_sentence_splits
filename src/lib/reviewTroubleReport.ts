import type { ReviewRating, ReviewTroubleLog, ReviewTroubleTag } from '../domain/types';
import { REVIEW_TROUBLE_TAGS } from './reviewTroubleTags';

/**
 * "Trouble tags" progress notes (docs/ROADMAP.md "Review trouble tags and
 * remediation queue", step 1). Answers: do I actually use the chips, do the
 * queued follow-ups get done, and do tagged cards go better afterwards?
 *
 * Pure, no Dexie/network. `getReviewTroubleReport` in the repository does the
 * fetching. The outcome comparison is observational and uncontrolled: a card
 * that had its follow-up done before its next review may have been the easier
 * one to begin with, so the panel presents counts, not a verdict.
 */

export interface TroubleReportReview {
  studyItemId: string;
  timestamp: string;
  rating: ReviewRating;
}

export interface TroubleReportEvent {
  sentenceId: string;
  timestamp: string;
}

export interface TroubleReportInput {
  logs: ReviewTroubleLog[];
  /** Reviews since the first log (any item), for the "how often do I tag a miss" rate. */
  reviews: TroubleReportReview[];
  /** `expression_attempt` learning events (a Fresh try being done). */
  expressionAttempts: TroubleReportEvent[];
  /** Saved shadowing attempts, with `createdAt` as `timestamp`. */
  shadowAttempts: TroubleReportEvent[];
}

export interface TroubleTagRow {
  tag: ReviewTroubleTag;
  label: string;
  count: number;
}

export interface FollowUpRow {
  queued: number;
  done: number;
}

export interface OutcomeGroup {
  /** Tagged reviews with a later review of the same card. */
  n: number;
  /** Of those, how many were rated good or easy the next time. */
  nextGoodOrEasy: number;
}

export interface ReviewTroubleReport {
  hasData: boolean;
  taggedReviews: number;
  /** Hard/Again reviews since the first tag, tagged or not; null denominator when there are none. */
  missReviews: number;
  taggedMisses: number;
  tags: TroubleTagRow[];
  freshTry: FollowUpRow;
  shadow: FollowUpRow;
  /** Tagged cards whose every queued follow-up was done before their next review. */
  followedUp: OutcomeGroup;
  /** Tagged cards with a queued follow-up that was not done before their next review. */
  notFollowedUp: OutcomeGroup;
}

function earliestAfter(events: TroubleReportEvent[], sentenceId: string, after: string): string | undefined {
  let earliest: string | undefined;
  for (const event of events) {
    if (event.sentenceId !== sentenceId || event.timestamp <= after) continue;
    if (earliest === undefined || event.timestamp < earliest) earliest = event.timestamp;
  }
  return earliest;
}

export function buildReviewTroubleReport(input: TroubleReportInput): ReviewTroubleReport {
  const { logs } = input;
  const tags: TroubleTagRow[] = REVIEW_TROUBLE_TAGS.map((tag) => ({
    tag: tag.value,
    label: tag.label,
    count: logs.filter((log) => log.tags.includes(tag.value)).length,
  }));
  const freshTry: FollowUpRow = { queued: 0, done: 0 };
  const shadow: FollowUpRow = { queued: 0, done: 0 };
  const followedUp: OutcomeGroup = { n: 0, nextGoodOrEasy: 0 };
  const notFollowedUp: OutcomeGroup = { n: 0, nextGoodOrEasy: 0 };

  const reviewsByItem = new Map<string, TroubleReportReview[]>();
  for (const review of input.reviews) {
    const list = reviewsByItem.get(review.studyItemId);
    if (list) list.push(review);
    else reviewsByItem.set(review.studyItemId, [review]);
  }

  for (const log of logs) {
    const freshTryDoneAt = log.queued.freshTry
      ? earliestAfter(input.expressionAttempts, log.sentenceId, log.timestamp)
      : undefined;
    const shadowDoneAt = log.queued.shadow
      ? earliestAfter(input.shadowAttempts, log.sentenceId, log.timestamp)
      : undefined;
    if (log.queued.freshTry) {
      freshTry.queued += 1;
      if (freshTryDoneAt) freshTry.done += 1;
    }
    if (log.queued.shadow) {
      shadow.queued += 1;
      if (shadowDoneAt) shadow.done += 1;
    }
    if (!log.queued.freshTry && !log.queued.shadow) continue;

    const next = (reviewsByItem.get(log.studyItemId) ?? [])
      .filter((review) => review.timestamp > log.timestamp)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))[0];
    if (!next) continue;
    const doneTimes: (string | undefined)[] = [];
    if (log.queued.freshTry) doneTimes.push(freshTryDoneAt);
    if (log.queued.shadow) doneTimes.push(shadowDoneAt);
    const allDoneBeforeNext = doneTimes.every((time) => time !== undefined && time < next.timestamp);
    const group = allDoneBeforeNext ? followedUp : notFollowedUp;
    group.n += 1;
    if (next.rating === 'good' || next.rating === 'easy') group.nextGoodOrEasy += 1;
  }

  const firstLog = logs.map((log) => log.timestamp).sort()[0];
  const misses = firstLog
    ? input.reviews.filter(
        (review) => review.timestamp >= firstLog && (review.rating === 'again' || review.rating === 'hard'),
      )
    : [];
  const taggedMisses = logs.filter((log) => log.rating === 'again' || log.rating === 'hard').length;

  return {
    hasData: logs.length > 0,
    taggedReviews: logs.length,
    missReviews: misses.length,
    taggedMisses,
    tags,
    freshTry,
    shadow,
    followedUp,
    notFollowedUp,
  };
}
