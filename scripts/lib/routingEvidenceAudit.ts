/**
 * Pure analysis behind `diagnose:routing-evidence` (ADAPTIVE_SCHEDULING_RESEARCH
 * stage 0). Counts what evidence exists for an attempt → help → follow-up
 * chain; it never estimates an intervention's effect, and every "follow-up" is
 * an opportunity, not a reconstructed causal episode.
 */

export interface ReviewRow {
  id: string;
  studyItemId: string;
  timestamp: string;
  rating: string;
  assistance: string[] | null;
  elapsedMs: number | null;
  predictedRetrievability: number | null;
  contextSentenceId: string | null;
  presentation: unknown;
  meaningChoice: unknown;
  comprehensionCheckCorrect: boolean | null;
  source: string | null;
}

export interface StudyItemRow {
  id: string;
  subjectType: string;
  subjectId: string;
  activityType: string;
}

export interface GlossRow {
  id: string;
  timestamp: string;
  visitId: string;
  sentenceId: string;
  skill: string;
  subskill: string;
  ruleKey: string;
  levelShown: number;
  firstCorrect: boolean | null;
  referenceConfidence: string;
  hintMaxStep: number;
  explanationOpened: boolean;
  blocker: string | null;
  vocabHelped: boolean;
  translationLevel: number;
  outcome: string;
  retryOfId?: string | null;
  helpSequence?: string[] | null;
  contentRevision?: string | null;
  firstResponseMs?: number | null;
}

export interface EventRow {
  id: string;
  timestamp: string;
  visitId: string;
  action: string;
  sentenceId: string;
  targetKey: string | null;
  support: string | null;
  outcome: string | null;
  helpLevel: string | null;
  exposedSentenceId: string | null;
}

export const DELAY_BUCKETS = ['<1d', '1-3d', '3-7d', '>7d'] as const;
export type DelayBucket = (typeof DELAY_BUCKETS)[number];

export function delayBucket(fromIso: string, toIso: string): DelayBucket {
  const days = (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
  if (days < 1) return '<1d';
  if (days < 3) return '1-3d';
  if (days < 7) return '3-7d';
  return '>7d';
}

export function emptyBuckets(): Record<DelayBucket, number> {
  return { '<1d': 0, '1-3d': 0, '3-7d': 0, '>7d': 0 };
}

const byTime = <T extends { timestamp: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

export function countBy<T>(rows: T[], key: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[key(row)] = (out[key(row)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

export interface CoverageRow {
  group: string;
  rows: number;
  /** Share (0..1) of rows with a usable value, per field. */
  fields: Record<string, number>;
}

const present = (value: unknown): boolean => value !== null && value !== undefined;

/** Per-group non-null coverage. An empty `assistance` array still counts as recorded. */
export function reviewCoverage(
  reviews: ReviewRow[],
  items: Map<string, StudyItemRow>,
  sinceIso?: string,
): CoverageRow[] {
  const groups = new Map<string, ReviewRow[]>();
  for (const review of reviews) {
    if (sinceIso && review.timestamp < sinceIso) continue;
    const group = items.get(review.studyItemId)?.activityType ?? '(study item missing)';
    groups.set(group, [...(groups.get(group) ?? []), review]);
  }
  const fields: Array<[string, (r: ReviewRow) => unknown]> = [
    ['assistance', (r) => r.assistance],
    ['elapsedMs', (r) => r.elapsedMs],
    ['predictedRetrievability', (r) => r.predictedRetrievability],
    ['contextSentenceId', (r) => r.contextSentenceId],
    ['presentation', (r) => r.presentation],
    ['meaningChoice', (r) => r.meaningChoice],
    ['comprehensionCheckCorrect', (r) => r.comprehensionCheckCorrect],
    ['source', (r) => r.source],
  ];
  return [...groups]
    .map(([group, rows]) => ({
      group,
      rows: rows.length,
      fields: Object.fromEntries(
        fields.map(([name, get]) => [name, rows.filter((r) => present(get(r))).length / rows.length]),
      ),
    }))
    .sort((a, b) => b.rows - a.rows);
}

export interface FollowUpSummary {
  misses: number;
  withSameItemFollowUp: number;
  withTransferFollowUp?: number;
  sameItemDelay: Record<DelayBucket, number>;
  transferDelay?: Record<DelayBucket, number>;
  /** Misses that already have no later opportunity at all. */
  withoutAnyFollowUp: number;
}

export interface GlossSummary {
  total: number;
  byOutcome: Record<string, number>;
  byReferenceConfidence: Record<string, number>;
  gradable: number;
  misses: number;
  missesWithBlocker: number;
  missesWithHelpRecorded: number;
  missBlockers: Record<string, number>;
  disputedByRule: Record<string, number>;
  bySkill: Record<string, { decisions: number; misses: number }>;
  /** Gradable attempts carrying each stage 1 link (rows before 2026-10-19 never will). */
  linkCoverage: { retryOfId: number; helpSequence: number; contentRevision: number; firstResponseMs: number };
  followUp: FollowUpSummary;
  /** Same, restricted to follow-ups shown at support level 4 (independent). */
  independentFollowUp: FollowUpSummary;
}

const isAttempt = (row: GlossRow): boolean =>
  row.firstCorrect !== null && row.outcome !== 'self_report' && row.outcome !== 'skipped';

export const glossHelpRecorded = (row: GlossRow): boolean =>
  row.hintMaxStep > 0 || row.explanationOpened || row.vocabHelped || row.translationLevel >= 2;

function glossFollowUps(rows: GlossRow[], independentOnly: boolean): FollowUpSummary {
  const sorted = byTime(rows).filter(isAttempt);
  const summary: FollowUpSummary = {
    misses: 0,
    withSameItemFollowUp: 0,
    withTransferFollowUp: 0,
    sameItemDelay: emptyBuckets(),
    transferDelay: emptyBuckets(),
    withoutAnyFollowUp: 0,
  };
  sorted.forEach((miss, index) => {
    if (miss.firstCorrect !== false) return;
    summary.misses += 1;
    const later = sorted
      .slice(index + 1)
      .filter((r) => r.visitId !== miss.visitId && Date.parse(r.timestamp) > Date.parse(miss.timestamp))
      .filter((r) => !independentOnly || r.levelShown === 4);
    const same = later.find((r) => r.sentenceId === miss.sentenceId && r.skill === miss.skill);
    const transfer = later.find((r) => r.sentenceId !== miss.sentenceId && r.ruleKey === miss.ruleKey);
    if (same) {
      summary.withSameItemFollowUp += 1;
      summary.sameItemDelay[delayBucket(miss.timestamp, same.timestamp)] += 1;
    }
    if (transfer) {
      summary.withTransferFollowUp! += 1;
      summary.transferDelay![delayBucket(miss.timestamp, transfer.timestamp)] += 1;
    }
    if (!same && !transfer) summary.withoutAnyFollowUp += 1;
  });
  return summary;
}

export function summariseGloss(rows: GlossRow[]): GlossSummary {
  const attempts = rows.filter(isAttempt);
  const misses = attempts.filter((r) => r.firstCorrect === false);
  const bySkill: GlossSummary['bySkill'] = {};
  for (const row of attempts) {
    const entry = (bySkill[row.skill] ??= { decisions: 0, misses: 0 });
    entry.decisions += 1;
    if (row.firstCorrect === false) entry.misses += 1;
  }
  return {
    total: rows.length,
    byOutcome: countBy(rows, (r) => r.outcome),
    byReferenceConfidence: countBy(rows, (r) => r.referenceConfidence),
    gradable: attempts.length,
    misses: misses.length,
    missesWithBlocker: misses.filter((r) => r.blocker).length,
    missesWithHelpRecorded: misses.filter(glossHelpRecorded).length,
    missBlockers: countBy(misses, (r) => r.blocker ?? '(none)'),
    disputedByRule: countBy(
      rows.filter((r) => r.outcome === 'disputed'),
      (r) => r.ruleKey,
    ),
    bySkill,
    linkCoverage: {
      retryOfId: attempts.filter((r) => r.retryOfId).length,
      helpSequence: attempts.filter((r) => r.helpSequence && r.helpSequence.length > 0).length,
      contentRevision: attempts.filter((r) => r.contentRevision).length,
      firstResponseMs: attempts.filter((r) => r.firstResponseMs != null).length,
    },
    followUp: glossFollowUps(rows, false),
    independentFollowUp: glossFollowUps(rows, true),
  };
}

export interface ReviewEpisodeSummary {
  activityType: string;
  reviews: number;
  /** Rating `again` — the only miss signal a review carries. */
  misses: number;
  missesWithAssistanceRecorded: number;
  missesWithLaterReview: number;
  delay: Record<DelayBucket, number>;
  /** Later review exists but only inside the same day, so it may be a same-session repeat. */
  sameDayOnly: number;
}

export function summariseReviewMisses(
  reviews: ReviewRow[],
  items: Map<string, StudyItemRow>,
): ReviewEpisodeSummary[] {
  const perItem = new Map<string, ReviewRow[]>();
  for (const review of byTime(reviews)) {
    perItem.set(review.studyItemId, [...(perItem.get(review.studyItemId) ?? []), review]);
  }
  const out = new Map<string, ReviewEpisodeSummary>();
  for (const [itemId, list] of perItem) {
    const activityType = items.get(itemId)?.activityType ?? '(study item missing)';
    const entry =
      out.get(activityType) ??
      {
        activityType,
        reviews: 0,
        misses: 0,
        missesWithAssistanceRecorded: 0,
        missesWithLaterReview: 0,
        delay: emptyBuckets(),
        sameDayOnly: 0,
      };
    out.set(activityType, entry);
    entry.reviews += list.length;
    list.forEach((review, index) => {
      if (review.rating !== 'again') return;
      entry.misses += 1;
      if (review.assistance && review.assistance.length > 0) entry.missesWithAssistanceRecorded += 1;
      const next = list[index + 1];
      if (!next) return;
      entry.missesWithLaterReview += 1;
      const bucket = delayBucket(review.timestamp, next.timestamp);
      entry.delay[bucket] += 1;
      if (bucket === '<1d') entry.sameDayOnly += 1;
    });
  }
  return [...out.values()].sort((a, b) => b.reviews - a.reviews);
}

export interface EventSummary {
  total: number;
  byAction: Record<string, number>;
  practice: number;
  practiceNeededHelp: number;
  /** needed_help practices that carry a target key (needed to link a follow-up). */
  neededHelpWithTarget: number;
  /** Later event in a different visit on the same target (any of practice / recheck / held-back / transfer). */
  neededHelpWithLaterTargetEvent: number;
  laterDelay: Record<DelayBucket, number>;
  /** Later event whose own outcome is known (got_it / needed_help). */
  laterWithOutcome: number;
  helpLevels: Record<string, number>;
}

const TARGET_FOLLOW_UP_ACTIONS = new Set([
  'target_practice',
  'held_back_check',
  'transfer_attempt',
  'transfer_recheck',
]);

export function summariseEvents(events: EventRow[]): EventSummary {
  const sorted = byTime(events);
  const practice = sorted.filter((e) => e.action === 'target_practice');
  const neededHelp = practice.filter((e) => e.outcome === 'needed_help');
  const summary: EventSummary = {
    total: events.length,
    byAction: countBy(events, (e) => e.action),
    practice: practice.length,
    practiceNeededHelp: neededHelp.length,
    neededHelpWithTarget: 0,
    neededHelpWithLaterTargetEvent: 0,
    laterDelay: emptyBuckets(),
    laterWithOutcome: 0,
    helpLevels: countBy(
      events.filter((e) => e.action === 'walkthrough_opened'),
      (e) => e.helpLevel ?? '(none)',
    ),
  };
  for (const miss of neededHelp) {
    if (!miss.targetKey) continue;
    summary.neededHelpWithTarget += 1;
    const next = sorted.find(
      (e) =>
        e.targetKey === miss.targetKey &&
        e.visitId !== miss.visitId &&
        TARGET_FOLLOW_UP_ACTIONS.has(e.action) &&
        Date.parse(e.timestamp) > Date.parse(miss.timestamp),
    );
    if (!next) continue;
    summary.neededHelpWithLaterTargetEvent += 1;
    summary.laterDelay[delayBucket(miss.timestamp, next.timestamp)] += 1;
    if (next.outcome) summary.laterWithOutcome += 1;
  }
  return summary;
}
