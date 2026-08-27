import type {
  FsrsState,
  PlannerSessionStep,
  PlannerStepStatus,
  PlannerStepTargetKind,
  SessionBucket,
  StudyActivityType,
  StudySubjectType,
} from '../domain/types';
import {
  BASELINE_SESSION_ALLOCATION,
  EXPLORE_STEP_MINUTES,
  MAX_NEGLECT_BOOST,
  MODE_ACTIVITY_ESTIMATE_MINUTES,
  NEGLECT_WINDOW_DAYS,
  PRACTICE_ACTIVITY_TYPES,
  REVIEW_PRIORITY_DEFAULT_LIMIT,
  STALE_PRIORITY_FLOOR,
  STALE_REENCOUNTER_DAYS,
  SYNTHETIC_ACTIVITY_TYPES,
} from './sessionPlannerConfig';

/**
 * The Learning Orchestrator's recommendation engine (docs/AI_OVERVIEW.md).
 * Pure functions only, no Dexie/network access — same convention as
 * scheduling.ts/maturity.ts, so the whole decision process is a plain,
 * inspectable pipeline over already-fetched data:
 *
 *   activity distribution -> neglect scores -> due-review ranking ->
 *   time allocation across modes -> concrete steps -> chain grouping ->
 *   human-readable explanation
 *
 * `src/db/repository.ts#getSessionPlannerInput` does the only Dexie
 * fetching, adapting live data into the plain input types below, then
 * calls buildRecommendedSession. This split is what makes the "why did it
 * recommend this" question answerable and unit-testable without a browser.
 */

export const ALL_SESSION_BUCKETS: SessionBucket[] = ['glossing', 'grammar', 'shadowing', 'review'];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Step 1-3: activity distribution & neglect
// ---------------------------------------------------------------------------

export interface RecentActivityEvent {
  mode: SessionBucket;
  timestamp: string;
}

export interface ModeActivitySummary {
  count: number;
  /** null = no activity in this mode has ever been observed (max neglect). */
  daysSinceLast: number | null;
}

export type ActivityDistribution = Record<SessionBucket, ModeActivitySummary>;

/** Step 2: how much of each mode the learner has actually done recently. */
export function computeRecentActivityDistribution(
  events: RecentActivityEvent[],
  now: Date,
  windowDays: number = NEGLECT_WINDOW_DAYS,
): ActivityDistribution {
  const windowStart = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  const distribution = {} as ActivityDistribution;
  for (const mode of ALL_SESSION_BUCKETS) {
    const modeEvents = events.filter((event) => event.mode === mode);
    const inWindow = modeEvents.filter(
      (event) => new Date(event.timestamp).getTime() >= windowStart,
    );
    const mostRecent = modeEvents.reduce<number | null>((latest, event) => {
      const time = new Date(event.timestamp).getTime();
      return latest === null || time > latest ? time : latest;
    }, null);
    distribution[mode] = {
      count: inWindow.length,
      daysSinceLast:
        mostRecent === null ? null : (now.getTime() - mostRecent) / (24 * 60 * 60 * 1000),
    };
  }
  return distribution;
}

export type NeglectScores = Record<SessionBucket, number>;

/**
 * Step 3: 0 (touched today) to 1 (never touched, or not touched within the
 * window) per mode. Deliberately linear/clamped, not exponential decay —
 * "deterministic and inspectable," per the design brief, beats a curve
 * nobody can eyeball.
 */
export function computeNeglectScores(
  distribution: ActivityDistribution,
  windowDays: number = NEGLECT_WINDOW_DAYS,
): NeglectScores {
  const scores = {} as NeglectScores;
  for (const mode of ALL_SESSION_BUCKETS) {
    const { daysSinceLast } = distribution[mode];
    scores[mode] = daysSinceLast === null ? 1 : clamp(daysSinceLast / windowDays, 0, 1);
  }
  return scores;
}

// ---------------------------------------------------------------------------
// Step 5: review-priority scoring (generalizes grammarPatterns.ts's
// computeGrammarPriorityBucket/explainGrammarPriority pattern across every
// subject type, rather than reinventing it per-subject).
// ---------------------------------------------------------------------------

export interface ReviewPriorityInput {
  studyItemId: string;
  subjectType: StudySubjectType;
  activityType: StudyActivityType;
  mode: SessionBucket;
  due: string;
  scheduledDays: number;
  state: FsrsState['state'];
  /** Context-diversity signal (src/lib/maturity.ts) — how many distinct sources this subject has appeared in. */
  distinctSourceCount: number;
  distinctSentenceCount: number;
  /** Out of the last few reviews of this study item, how many were "again". */
  recentAgainCount: number;
  recentReviewCount: number;
  /**
   * Days since this subject was last freshly encountered (a natural
   * encounter, or a new sentence/context linking it) beyond its original
   * creation — null when there's no re-encounter signal at all, which is
   * treated as "not stale" (nothing to decay against) rather than
   * penalized, since most subjects simply don't have this signal yet.
   */
  daysSinceLastEncounter: number | null;
  now: Date;
}

export interface ReviewPriorityResult {
  studyItemId: string;
  mode: SessionBucket;
  activityType: StudyActivityType;
  score: number;
  reasons: string[];
}

/**
 * priority ~= forgetting risk x usefulness x re-encounter freshness, plus a
 * standalone weakness term (additive, not folded into the product — a
 * single-context item with recentAgainCount=0 would otherwise multiply to
 * ~0 and never surface, which is wrong: a brand-new due item is still worth
 * doing). Not bound to the prompt's literal multiplicative formula, per its
 * own "do not feel bound to that" note — this is the shape that actually
 * behaves sensibly against this app's real signals.
 */
export function scoreReviewPriority(input: ReviewPriorityInput): ReviewPriorityResult {
  const overdueDays = Math.max(
    0,
    (input.now.getTime() - new Date(input.due).getTime()) / (24 * 60 * 60 * 1000),
  );
  const intervalDays = Math.max(1, input.scheduledDays);
  const forgettingRisk =
    input.state === 'new' || input.state === 'learning'
      ? 1
      : clamp(overdueDays / intervalDays, 0.25, 2);

  const usefulness = clamp(
    0.5 +
      0.2 * Math.max(0, input.distinctSourceCount - 1) +
      0.05 * Math.max(0, input.distinctSentenceCount - 1),
    0.5,
    1.5,
  );

  const weakness =
    input.recentReviewCount > 0 ? input.recentAgainCount / input.recentReviewCount : 0.3;

  const staleness =
    input.daysSinceLastEncounter === null
      ? 1
      : clamp(
          1 -
            (0.75 * Math.max(0, input.daysSinceLastEncounter - STALE_REENCOUNTER_DAYS)) /
              STALE_REENCOUNTER_DAYS,
          STALE_PRIORITY_FLOOR,
          1,
        );

  const score = forgettingRisk * usefulness * staleness + weakness * 0.5;

  const reasons: string[] = [];
  if (input.state === 'new' || input.state === 'learning') {
    reasons.push('New or still learning');
  } else if (overdueDays >= 1) {
    reasons.push(`${Math.round(overdueDays)}d overdue`);
  }
  if (input.distinctSourceCount > 1) reasons.push(`seen in ${input.distinctSourceCount} sources`);
  if (input.recentReviewCount > 0 && input.recentAgainCount > 0) {
    reasons.push(`missed ${input.recentAgainCount}/${input.recentReviewCount} recently`);
  }
  if (staleness < 1) reasons.push('not re-encountered in a while');

  return {
    studyItemId: input.studyItemId,
    mode: input.mode,
    activityType: input.activityType,
    score,
    reasons,
  };
}

/** Step 5: best `limit` due items, highest score first — "choose the best N reviews," not the whole due queue. */
export function rankReviewPriorities(
  inputs: ReviewPriorityInput[],
  limit: number = REVIEW_PRIORITY_DEFAULT_LIMIT,
): ReviewPriorityResult[] {
  return inputs
    .map(scoreReviewPriority)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Step 6: allocate the session's total minutes across the four modes
// ---------------------------------------------------------------------------

export interface AllocateTimeInput {
  totalMinutes: number;
  neglectScores: NeglectScores;
  baseline?: Record<SessionBucket, number>;
  maxNeglectBoost?: number;
  /** Hard ceiling on how many minutes a mode can actually absorb (e.g. Retain when the due backlog is thin) — leftover redistributes to the other modes. */
  availableMinutesByMode?: Partial<Record<SessionBucket, number>>;
}

function roundAllocation(
  raw: Map<SessionBucket, number>,
  totalMinutes: number,
): Record<SessionBucket, number> {
  const rounded = {} as Record<SessionBucket, number>;
  let sum = 0;
  for (const mode of ALL_SESSION_BUCKETS) {
    const value = Math.round(raw.get(mode) ?? 0);
    rounded[mode] = value;
    sum += value;
  }
  const drift = Math.round(totalMinutes) - sum;
  if (drift !== 0) {
    const largest = ALL_SESSION_BUCKETS.reduce((best, mode) =>
      rounded[mode] > rounded[best] ? mode : best,
    );
    rounded[largest] = Math.max(0, rounded[largest] + drift);
  }
  return rounded;
}

/**
 * Step 6: baseline shares (prompt's 35/20/20/25 guideline), nudged toward
 * neglected modes, then clamped against however much each mode can actually
 * absorb (`availableMinutesByMode`) — e.g. Retain never gets more minutes
 * than its top-ranked due items can use, so a thin backlog doesn't force
 * padding with low-value reviews; the freed time goes to the other modes
 * instead of sitting idle.
 */
export function allocateTimeAcrossModes(input: AllocateTimeInput): Record<SessionBucket, number> {
  const baseline = input.baseline ?? BASELINE_SESSION_ALLOCATION;
  const boost = input.maxNeglectBoost ?? MAX_NEGLECT_BOOST;
  const weights = new Map<SessionBucket, number>(
    ALL_SESSION_BUCKETS.map((mode) => [
      mode,
      baseline[mode] * (1 + boost * input.neglectScores[mode]),
    ]),
  );

  const allocation = new Map<SessionBucket, number>();
  let remainingMinutes = input.totalMinutes;
  const openModes = new Set<SessionBucket>(ALL_SESSION_BUCKETS);

  // At most one mode gets newly capped per pass, so this terminates within
  // ALL_SESSION_BUCKETS.length iterations.
  for (let pass = 0; pass < ALL_SESSION_BUCKETS.length; pass += 1) {
    if (openModes.size === 0) break;
    const openWeightSum = [...openModes].reduce((sum, mode) => sum + (weights.get(mode) ?? 0), 0);
    if (openWeightSum <= 0) break;

    let cappedThisPass = false;
    for (const mode of [...openModes]) {
      const share = remainingMinutes * ((weights.get(mode) ?? 0) / openWeightSum);
      const ceiling = input.availableMinutesByMode?.[mode];
      if (ceiling !== undefined && share > ceiling) {
        allocation.set(mode, ceiling);
        remainingMinutes -= ceiling;
        openModes.delete(mode);
        cappedThisPass = true;
      }
    }
    if (!cappedThisPass) {
      for (const mode of openModes) {
        allocation.set(mode, remainingMinutes * ((weights.get(mode) ?? 0) / openWeightSum));
      }
      openModes.clear();
    }
  }
  for (const mode of openModes) allocation.set(mode, 0);

  return roundAllocation(allocation, input.totalMinutes);
}

// ---------------------------------------------------------------------------
// Steps 4/7/8: candidate activities and concrete step selection
// ---------------------------------------------------------------------------

export interface DueBatchCandidate {
  priorities: ReviewPriorityResult[];
}

export interface ExploreCandidate {
  bookId: string;
  label: string;
  reason: string;
  /** Ordered next unstarted sentences in this book, capped at EXPLORE_SENTENCE_PREVIEW_LIMIT — one step drafted per entry until the shared glossing budget runs out. */
  sentences: {
    sentenceId: string;
    preview: string;
    vocabularyConfirmed: boolean;
    /** Every reviewable vocabulary item confirmed for this sentence has itself reached FSRS proficiency (review/relearning), per isSentenceReadyForFullReview — see buildExploreSteps. */
    vocabularyReady: boolean;
  }[];
}

export interface UnderstandCandidate {
  grammarPatternId: string;
  label: string;
  reason: string;
  /** Example-sentence id, when known — enables chain grouping with an Explore/shadow step on the same sentence. */
  sentenceId?: string;
}

export interface ShadowCandidate {
  sentenceId: string;
  bookId?: string;
  label: string;
  reason: string;
}

export interface SessionPlannerInput {
  now: Date;
  /** Minutes this planning pass has to work with — the day's starting budget on first plan, or just the increment being added on a later top-up (see `addMinutesToTodaySession`). */
  totalMinutes: number;
  recentActivity: RecentActivityEvent[];
  /** Due StudyItems costed at the quicker "retain" per-item rate (comprehension/reading_retrieval/listening/etc) — merged with practiceDue into one ranked `review` batch. */
  retainDue: ReviewPriorityInput[];
  /** Due StudyItems costed at the slower "practice" per-item rate (cloze/reading_production/sentence_transformation/contrastive/grammar_completion/grammar_contrast) — merged with retainDue into one ranked `review` batch. */
  practiceDue: ReviewPriorityInput[];
  exploreCandidates: ExploreCandidate[];
  understandCandidates: UnderstandCandidate[];
  shadowCandidates: ShadowCandidate[];
  reviewLimit?: number;
  /** User-adjustable override for BASELINE_SESSION_ALLOCATION (set directly on Home) — see AllocateTimeInput.baseline. */
  baseline?: Record<SessionBucket, number>;
}

export interface PlannerStepDraft {
  id: string;
  bucket: SessionBucket;
  activityType: string;
  targetKind: PlannerStepTargetKind;
  bookId?: string;
  sentenceId?: string;
  grammarPatternId?: string;
  vocabularyItemId?: string;
  label: string;
  estimatedMinutes: number;
  reason: string;
  status: PlannerStepStatus;
  targetCount?: number;
}

export interface RecommendedSession {
  targetMinutes: number;
  allocation: Record<SessionBucket, number>;
  neglectScores: NeglectScores;
  steps: PlannerStepDraft[];
  explanation: string[];
}

let stepCounter = 0;
function draftStepId(): string {
  stepCounter += 1;
  return `draft_${stepCounter}`;
}

const PRACTICE_ACTIVITY_TYPE_SET = new Set<string>(PRACTICE_ACTIVITY_TYPES);

/** Retain-costed items ("recognize/reveal/self-rate") are quicker than practice-costed ones ("type/produce an answer") — see MODE_ACTIVITY_ESTIMATE_MINUTES. */
function reviewItemCostMinutes(activityType: StudyActivityType): number {
  return PRACTICE_ACTIVITY_TYPE_SET.has(activityType)
    ? MODE_ACTIVITY_ESTIMATE_MINUTES.practice
    : MODE_ACTIVITY_ESTIMATE_MINUTES.retain;
}

/** Sum of per-item costs for the first `limit` ranked items — used both to build the actual step and to compute how many minutes the `review` bucket can actually absorb (see buildRecommendedSession's reviewCeiling). */
function reviewBatchCostMinutes(ranked: ReviewPriorityResult[], limit: number): number {
  return ranked.slice(0, limit).reduce((sum, item) => sum + reviewItemCostMinutes(item.activityType), 0);
}

/**
 * Step 7 (review bucket): one batched step for "do N due reviews" rather
 * than one step per card — ReviewPage's own due queue is the actual
 * execution surface. Retain- and practice-costed items are ranked together
 * (score doesn't care which pool an item came from) and packed by walking
 * the ranked list summing each item's own cost, since the two pools cost
 * different amounts per item — a plain count-based pack would misprice a
 * batch that's mostly one type or the other.
 */
function buildReviewBatchStep(ranked: ReviewPriorityResult[], budgetMinutes: number): PlannerStepDraft | null {
  let used = 0;
  const chosen: ReviewPriorityResult[] = [];
  for (const item of ranked) {
    const cost = reviewItemCostMinutes(item.activityType);
    if (used + cost > budgetMinutes) break;
    used += cost;
    chosen.push(item);
  }
  if (chosen.length === 0) return null;
  const topReasons = [...new Set(chosen.flatMap((item) => item.reasons))].slice(0, 2);
  return {
    id: draftStepId(),
    bucket: 'review',
    activityType: 'due_review_batch',
    targetKind: 'review',
    label: `Review ${chosen.length} high-priority item${chosen.length === 1 ? '' : 's'}`,
    estimatedMinutes: used,
    reason: topReasons.length > 0 ? topReasons.join(', ') : 'Due for review',
    status: 'pending',
    targetCount: chosen.length,
  };
}

/**
 * Step 7 (glossing): continue the highest-priority book(s) — one step per
 * book, sized to the remaining budget. Vocabulary-first by design (user
 * request, 2026-08-27): a not-yet-confirmed sentence only gets its
 * `vocabulary_review` step, never `continue_book` (structural analysis,
 * which surfaces literal-English glosses per chunk) in the same pass —
 * otherwise the learner sees a sentence's grammar/meaning glossed before
 * they've even looked at its words. Once vocabulary is confirmed,
 * `continue_book` stays withheld further still until every one of the
 * sentence's vocabulary items has itself reached FSRS proficiency
 * (`vocabularyReady`, reusing the same `isSentenceReadyForFullReview` rule
 * that already gates full-sentence review cards) — confirming a word isn't
 * the same as having demonstrated recall of it. A sentence that's confirmed
 * but not yet proficient gets no step at all this pass (its words are still
 * maturing via the review bucket); the loop moves on to the next sentence
 * rather than blocking the book's progress on it.
 */
function buildExploreSteps(
  candidates: ExploreCandidate[],
  budgetMinutes: number,
): PlannerStepDraft[] {
  const steps: PlannerStepDraft[] = [];
  let remaining = budgetMinutes;
  outer: for (const candidate of candidates) {
    for (const sentence of candidate.sentences) {
      if (sentence.vocabularyConfirmed && sentence.vocabularyReady) {
        const cost = EXPLORE_STEP_MINUTES.analyze;
        if (remaining < cost) break outer;
        steps.push({
          id: draftStepId(),
          bucket: 'glossing',
          activityType: SYNTHETIC_ACTIVITY_TYPES.newSentence,
          targetKind: 'continue_book',
          bookId: candidate.bookId,
          sentenceId: sentence.sentenceId,
          label: `Continue ${candidate.label}: ${sentence.preview}`,
          estimatedMinutes: cost,
          reason: candidate.reason,
          status: 'pending',
        });
        remaining -= cost;
      } else if (!sentence.vocabularyConfirmed) {
        const cost = EXPLORE_STEP_MINUTES.vocabulary;
        if (remaining < cost) break outer;
        steps.push({
          id: draftStepId(),
          bucket: 'glossing',
          activityType: SYNTHETIC_ACTIVITY_TYPES.vocabularyReview,
          targetKind: 'vocabulary_review',
          bookId: candidate.bookId,
          sentenceId: sentence.sentenceId,
          label: `Vocabulary: ${sentence.preview}`,
          estimatedMinutes: cost,
          reason: candidate.reason,
          status: 'pending',
        });
        remaining -= cost;
      }
    }
  }
  return steps;
}

/** Step 7 (grammar): one step per grammar pattern worth examining, in priority order, until the budget runs out. */
function buildUnderstandSteps(
  candidates: UnderstandCandidate[],
  budgetMinutes: number,
  perItemMinutes: number,
): PlannerStepDraft[] {
  const steps: PlannerStepDraft[] = [];
  let remaining = budgetMinutes;
  for (const candidate of candidates) {
    if (remaining < perItemMinutes) break;
    steps.push({
      id: draftStepId(),
      bucket: 'grammar',
      activityType: SYNTHETIC_ACTIVITY_TYPES.grammarExplore,
      targetKind: 'grammar_detail',
      grammarPatternId: candidate.grammarPatternId,
      sentenceId: candidate.sentenceId,
      label: `Examine ${candidate.label}`,
      estimatedMinutes: perItemMinutes,
      reason: candidate.reason,
      status: 'pending',
    });
    remaining -= perItemMinutes;
  }
  return steps;
}

/** Step 7 (shadowing): one step per sentence to shadow, sized to its own top-level bucket allocation. */
function buildShadowSteps(
  candidates: ShadowCandidate[],
  budgetMinutes: number,
  perItemMinutes: number,
): PlannerStepDraft[] {
  const steps: PlannerStepDraft[] = [];
  let remaining = budgetMinutes;
  for (const candidate of candidates) {
    if (remaining < perItemMinutes) break;
    steps.push({
      id: draftStepId(),
      bucket: 'shadowing',
      activityType: SYNTHETIC_ACTIVITY_TYPES.shadowingPractice,
      targetKind: 'shadow',
      bookId: candidate.bookId,
      sentenceId: candidate.sentenceId,
      label: `Shadow: ${candidate.label}`,
      estimatedMinutes: perItemMinutes,
      reason: candidate.reason,
      status: 'pending',
    });
    remaining -= perItemMinutes;
  }
  return steps;
}

/** Step 8: reorder so steps sharing a sentenceId (same source material) sit next to each other, preserving mode order otherwise. */
function preferCoherentChains(steps: PlannerStepDraft[]): {
  steps: PlannerStepDraft[];
  chainedSentenceIds: string[];
} {
  const bySentence = new Map<string, PlannerStepDraft[]>();
  const unlinked: PlannerStepDraft[] = [];
  for (const step of steps) {
    if (!step.sentenceId) {
      unlinked.push(step);
      continue;
    }
    const list = bySentence.get(step.sentenceId);
    if (list) list.push(step);
    else bySentence.set(step.sentenceId, [step]);
  }

  const chainedSentenceIds: string[] = [];
  const ordered: PlannerStepDraft[] = [];
  const consumedSentenceIds = new Set<string>();
  for (const step of steps) {
    if (!step.sentenceId || consumedSentenceIds.has(step.sentenceId)) continue;
    const group = bySentence.get(step.sentenceId) ?? [step];
    consumedSentenceIds.add(step.sentenceId);
    ordered.push(...group);
    if (group.length > 1) chainedSentenceIds.push(step.sentenceId);
  }
  ordered.push(...unlinked);
  return { steps: ordered, chainedSentenceIds };
}

function explainNeglect(neglectScores: NeglectScores, distribution: ActivityDistribution): string[] {
  const explanations: string[] = [];
  const sortedByNeglect = [...ALL_SESSION_BUCKETS].sort(
    (a, b) => neglectScores[b] - neglectScores[a],
  );
  const mostNeglected = sortedByNeglect[0]!;
  if (neglectScores[mostNeglected] >= 0.7) {
    const days = distribution[mostNeglected].daysSinceLast;
    explanations.push(
      days === null
        ? `You haven't done any ${mostNeglected} work yet — this session leans that way.`
        : `You haven't touched ${mostNeglected} in ${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}, so this session emphasizes it.`,
    );
  }
  const mostActive = [...ALL_SESSION_BUCKETS].sort(
    (a, b) => distribution[b].count - distribution[a].count,
  )[0]!;
  if (
    distribution[mostActive].count >= 5 &&
    neglectScores[mostActive] === 0 &&
    mostActive !== mostNeglected
  ) {
    explanations.push(`Your study has been ${mostActive}-heavy this week, so it's de-emphasized here.`);
  }
  return explanations;
}

/**
 * The full pipeline (design brief's numbered sequence), composed. Never
 * throws on sparse/empty input — a brand-new user with no history simply
 * gets the plain baseline allocation and whatever candidates exist (which
 * may be zero steps for a mode), not an error.
 */
/** Maps a session step to the page that actually does the work, so runners can deep-link into it. */
export function sessionStepTargetPath(step: PlannerSessionStep): string | null {
  switch (step.targetKind) {
    case 'continue_book':
      return step.bookId && step.sentenceId
        ? `/books/${step.bookId}/analyze/${step.sentenceId}`
        : null;
    case 'vocabulary_review':
      return step.bookId && step.sentenceId
        ? `/books/${step.bookId}/vocabulary/${step.sentenceId}`
        : null;
    case 'grammar_detail':
      return step.grammarPatternId ? `/grammar/${encodeURIComponent(step.grammarPatternId)}` : null;
    case 'shadow':
      return step.bookId && step.sentenceId
        ? `/books/${step.bookId}/shadow/${step.sentenceId}`
        : null;
    case 'review':
      return step.bookId ? `/books/${step.bookId}/review` : '/review';
    case 'vocabulary_detail':
      return '/vocabulary';
  }
}

export function buildRecommendedSession(input: SessionPlannerInput): RecommendedSession {
  const totalMinutes = input.totalMinutes;
  const reviewLimit = input.reviewLimit ?? REVIEW_PRIORITY_DEFAULT_LIMIT;

  const distribution = computeRecentActivityDistribution(input.recentActivity, input.now);
  const neglectScores = computeNeglectScores(distribution);

  // retainDue/practiceDue are ranked together — the score doesn't care which
  // pool an item came from, and ReviewPage itself doesn't distinguish them
  // either (one shared due-queue). reviewLimit still caps the combined pool
  // to "the best N," not both pools' worth.
  const rankedReview = rankReviewPriorities([...input.retainDue, ...input.practiceDue], reviewLimit);
  const reviewCeiling = reviewBatchCostMinutes(rankedReview, reviewLimit);

  const allocation = allocateTimeAcrossModes({
    totalMinutes,
    neglectScores,
    baseline: input.baseline,
    availableMinutesByMode: { review: reviewCeiling },
  });

  const reviewStep = buildReviewBatchStep(rankedReview, allocation.review);

  const shadowSteps = buildShadowSteps(
    input.shadowCandidates,
    allocation.shadowing,
    MODE_ACTIVITY_ESTIMATE_MINUTES.shadowing,
  );

  const exploreSteps = buildExploreSteps(input.exploreCandidates, allocation.glossing);
  const understandSteps = buildUnderstandSteps(
    input.understandCandidates,
    allocation.grammar,
    MODE_ACTIVITY_ESTIMATE_MINUTES.grammar,
  );

  const allSteps = [
    ...exploreSteps,
    ...understandSteps,
    ...shadowSteps,
    ...(reviewStep ? [reviewStep] : []),
  ];
  const { steps: orderedSteps, chainedSentenceIds } = preferCoherentChains(allSteps);

  const explanation = explainNeglect(neglectScores, distribution);
  if (reviewCeiling < allocation.review + MODE_ACTIVITY_ESTIMATE_MINUTES.retain && rankedReview.length < reviewLimit) {
    explanation.push('No large review backlog right now, so extra time went to other activities.');
  }
  if (chainedSentenceIds.length > 0) {
    explanation.push('Some steps below share the same sentence, so they run back to back.');
  }
  if (explanation.length === 0) {
    explanation.push('A balanced mix across glossing, grammar, shadowing, and review.');
  }

  return {
    targetMinutes: totalMinutes,
    allocation,
    neglectScores,
    steps: orderedSteps,
    explanation,
  };
}
