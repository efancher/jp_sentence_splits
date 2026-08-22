import type {
  FsrsState,
  LearningMode,
  PlannerStepStatus,
  PlannerStepTargetKind,
  StudyActivityType,
  StudySubjectType,
} from '../domain/types';
import {
  BASELINE_MODE_ALLOCATION,
  MAX_NEGLECT_BOOST,
  MODE_ACTIVITY_ESTIMATE_MINUTES,
  NEGLECT_WINDOW_DAYS,
  REVIEW_PRIORITY_DEFAULT_LIMIT,
  SHADOW_MIN_SHARE_OF_PRACTICE,
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

export const ALL_LEARNING_MODES: LearningMode[] = ['explore', 'understand', 'practice', 'retain'];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Step 1-3: activity distribution & neglect
// ---------------------------------------------------------------------------

export interface RecentActivityEvent {
  mode: LearningMode;
  timestamp: string;
}

export interface ModeActivitySummary {
  count: number;
  /** null = no activity in this mode has ever been observed (max neglect). */
  daysSinceLast: number | null;
}

export type ActivityDistribution = Record<LearningMode, ModeActivitySummary>;

/** Step 2: how much of each mode the learner has actually done recently. */
export function computeRecentActivityDistribution(
  events: RecentActivityEvent[],
  now: Date,
  windowDays: number = NEGLECT_WINDOW_DAYS,
): ActivityDistribution {
  const windowStart = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  const distribution = {} as ActivityDistribution;
  for (const mode of ALL_LEARNING_MODES) {
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

export type NeglectScores = Record<LearningMode, number>;

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
  for (const mode of ALL_LEARNING_MODES) {
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
  mode: LearningMode;
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
  mode: LearningMode;
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
  baseline?: Record<LearningMode, number>;
  maxNeglectBoost?: number;
  /** Hard ceiling on how many minutes a mode can actually absorb (e.g. Retain when the due backlog is thin) — leftover redistributes to the other modes. */
  availableMinutesByMode?: Partial<Record<LearningMode, number>>;
}

function roundAllocation(
  raw: Map<LearningMode, number>,
  totalMinutes: number,
): Record<LearningMode, number> {
  const rounded = {} as Record<LearningMode, number>;
  let sum = 0;
  for (const mode of ALL_LEARNING_MODES) {
    const value = Math.round(raw.get(mode) ?? 0);
    rounded[mode] = value;
    sum += value;
  }
  const drift = Math.round(totalMinutes) - sum;
  if (drift !== 0) {
    const largest = ALL_LEARNING_MODES.reduce((best, mode) =>
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
export function allocateTimeAcrossModes(input: AllocateTimeInput): Record<LearningMode, number> {
  const baseline = input.baseline ?? BASELINE_MODE_ALLOCATION;
  const boost = input.maxNeglectBoost ?? MAX_NEGLECT_BOOST;
  const weights = new Map<LearningMode, number>(
    ALL_LEARNING_MODES.map((mode) => [
      mode,
      baseline[mode] * (1 + boost * input.neglectScores[mode]),
    ]),
  );

  const allocation = new Map<LearningMode, number>();
  let remainingMinutes = input.totalMinutes;
  const openModes = new Set<LearningMode>(ALL_LEARNING_MODES);

  // At most one mode gets newly capped per pass, so this terminates within
  // ALL_LEARNING_MODES.length iterations.
  for (let pass = 0; pass < ALL_LEARNING_MODES.length; pass += 1) {
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
  sentenceId: string;
  label: string;
  reason: string;
  /** How many not-yet-studied sentences remain in this book, for scaling the step's size to the time budget. */
  remainingCount: number;
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
  /** Due StudyItems eligible for Retain-mode steps (comprehension/reading_retrieval/listening/etc), already scoring-ready. */
  retainDue: ReviewPriorityInput[];
  /** Due StudyItems eligible for Practice-mode steps (cloze/reading_production/sentence_transformation/contrastive/grammar_completion/grammar_contrast). */
  practiceDue: ReviewPriorityInput[];
  exploreCandidates: ExploreCandidate[];
  understandCandidates: UnderstandCandidate[];
  shadowCandidates: ShadowCandidate[];
  reviewLimit?: number;
  /** User-adjustable override for BASELINE_MODE_ALLOCATION (Settings page) — see AllocateTimeInput.baseline. */
  baseline?: Record<LearningMode, number>;
}

export interface PlannerStepDraft {
  id: string;
  mode: LearningMode;
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
}

export interface RecommendedSession {
  targetMinutes: number;
  allocation: Record<LearningMode, number>;
  neglectScores: NeglectScores;
  steps: PlannerStepDraft[];
  explanation: string[];
}

let stepCounter = 0;
function draftStepId(): string {
  stepCounter += 1;
  return `draft_${stepCounter}`;
}

function packCount(budgetMinutes: number, perItemMinutes: number, maxCount: number): number {
  if (perItemMinutes <= 0 || budgetMinutes <= 0) return 0;
  return clamp(Math.floor(budgetMinutes / perItemMinutes), 0, maxCount);
}

/** Step 7 (Retain/Practice halves): one batched step for "do N due reviews" rather than one step per card — ReviewPage's own due queue is the actual execution surface. */
function buildDueBatchStep(
  mode: LearningMode,
  ranked: ReviewPriorityResult[],
  budgetMinutes: number,
  perItemMinutes: number,
  activityType: string,
): PlannerStepDraft | null {
  const count = packCount(budgetMinutes, perItemMinutes, ranked.length);
  if (count === 0) return null;
  const chosen = ranked.slice(0, count);
  const topReasons = [...new Set(chosen.flatMap((item) => item.reasons))].slice(0, 2);
  return {
    id: draftStepId(),
    mode,
    activityType,
    targetKind: 'review',
    label: `Review ${count} high-priority item${count === 1 ? '' : 's'}`,
    estimatedMinutes: count * perItemMinutes,
    reason: topReasons.length > 0 ? topReasons.join(', ') : 'Due for review',
    status: 'pending',
  };
}

/** Step 7 (Explore): continue the highest-priority book(s) — one step per book, sized to the remaining budget. */
function buildExploreSteps(
  candidates: ExploreCandidate[],
  budgetMinutes: number,
  perItemMinutes: number,
): PlannerStepDraft[] {
  const steps: PlannerStepDraft[] = [];
  let remaining = budgetMinutes;
  for (const candidate of candidates) {
    if (remaining < perItemMinutes) break;
    const count = packCount(remaining, perItemMinutes, candidate.remainingCount);
    if (count === 0) continue;
    const minutes = count * perItemMinutes;
    steps.push({
      id: draftStepId(),
      mode: 'explore',
      activityType: SYNTHETIC_ACTIVITY_TYPES.newSentence,
      targetKind: 'continue_book',
      bookId: candidate.bookId,
      sentenceId: candidate.sentenceId,
      label: `Continue ${candidate.label} — ${count} new sentence${count === 1 ? '' : 's'}`,
      estimatedMinutes: minutes,
      reason: candidate.reason,
      status: 'pending',
    });
    remaining -= minutes;
  }
  return steps;
}

/** Step 7 (Understand): one step per grammar pattern worth examining, in priority order, until the budget runs out. */
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
      mode: 'understand',
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

/** Step 7 (Practice, shadowing half): one step per sentence to shadow, after the batched due-practice step (if any) has claimed its share. */
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
      mode: 'practice',
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
  const sortedByNeglect = [...ALL_LEARNING_MODES].sort(
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
  const mostActive = [...ALL_LEARNING_MODES].sort(
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
export function buildRecommendedSession(input: SessionPlannerInput): RecommendedSession {
  const totalMinutes = input.totalMinutes;
  const reviewLimit = input.reviewLimit ?? REVIEW_PRIORITY_DEFAULT_LIMIT;

  const distribution = computeRecentActivityDistribution(input.recentActivity, input.now);
  const neglectScores = computeNeglectScores(distribution);

  const rankedRetain = rankReviewPriorities(input.retainDue, reviewLimit);
  const rankedPractice = rankReviewPriorities(input.practiceDue, reviewLimit);

  const retainEstimate = MODE_ACTIVITY_ESTIMATE_MINUTES.retain;
  const retainCeiling = rankedRetain.length * retainEstimate;

  const allocation = allocateTimeAcrossModes({
    totalMinutes,
    neglectScores,
    baseline: input.baseline,
    availableMinutesByMode: { retain: retainCeiling },
  });

  const practiceEstimate = MODE_ACTIVITY_ESTIMATE_MINUTES.practice;
  // Reserve shadowing's cut of Practice before the due-practice batch is
  // built, so a large due-practice backlog can't claim the whole budget and
  // squeeze shadow candidates out entirely (floored at one item's worth, so
  // the reserve is never too small to actually produce a step).
  const shadowReserve =
    input.shadowCandidates.length > 0
      ? Math.min(
          allocation.practice,
          Math.max(practiceEstimate, allocation.practice * SHADOW_MIN_SHARE_OF_PRACTICE),
        )
      : 0;
  const dueBatchStep = buildDueBatchStep(
    'practice',
    rankedPractice,
    allocation.practice - shadowReserve,
    practiceEstimate,
    'due_practice_batch',
  );
  const shadowBudget = allocation.practice - (dueBatchStep?.estimatedMinutes ?? 0);
  const shadowSteps = buildShadowSteps(input.shadowCandidates, shadowBudget, practiceEstimate);

  const retainStep = buildDueBatchStep(
    'retain',
    rankedRetain,
    allocation.retain,
    retainEstimate,
    'due_retain_batch',
  );

  const exploreSteps = buildExploreSteps(
    input.exploreCandidates,
    allocation.explore,
    MODE_ACTIVITY_ESTIMATE_MINUTES.explore,
  );
  const understandSteps = buildUnderstandSteps(
    input.understandCandidates,
    allocation.understand,
    MODE_ACTIVITY_ESTIMATE_MINUTES.understand,
  );

  const allSteps = [
    ...exploreSteps,
    ...understandSteps,
    ...(dueBatchStep ? [dueBatchStep] : []),
    ...shadowSteps,
    ...(retainStep ? [retainStep] : []),
  ];
  const { steps: orderedSteps, chainedSentenceIds } = preferCoherentChains(allSteps);

  const explanation = explainNeglect(neglectScores, distribution);
  if (retainCeiling < allocation.retain + retainEstimate && rankedRetain.length < reviewLimit) {
    explanation.push('No large review backlog right now, so extra time went to other activities.');
  }
  if (chainedSentenceIds.length > 0) {
    explanation.push('Some steps below share the same sentence, so they run back to back.');
  }
  if (explanation.length === 0) {
    explanation.push('A balanced mix across explore, understand, practice, and retain.');
  }

  return {
    targetMinutes: totalMinutes,
    allocation,
    neglectScores,
    steps: orderedSteps,
    explanation,
  };
}
