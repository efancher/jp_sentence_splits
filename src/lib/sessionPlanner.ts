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
  WORD_CHECK_STEPS_PER_PLAN,
  WORD_CHECK_STEP_MINUTES,
  GRAMMAR_CHECK_STEPS_PER_PLAN,
  LISTENING_TOOL_STEPS_PER_PLAN,
  LISTENING_TOOL_STEP_MINUTES,
  READ_CHECK_STEPS_PER_PLAN,
  READ_CHECK_STEP_MINUTES,
  GAME_BREAK_INTERVAL_MINUTES,
  GAME_BREAK_MAX_PER_PASS,
  GAME_BREAK_MINUTES,
  MAX_NEGLECT_BOOST,
  MODE_ACTIVITY_ESTIMATE_MINUTES,
  NEGLECT_WINDOW_DAYS,
  PRACTICE_ACTIVITY_TYPES,
  REDISTRIBUTION_MAX_SHARE_MULTIPLE,
  REVIEW_PRIORITY_DEFAULT_LIMIT,
  REVIEW_STEP_BATCH_SIZE,
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
  /**
   * How many events this entry stands for (default 1). Large tables report one entry
   * with a count and their newest time instead of one object per row, which keeps this
   * live query cheap while thousands of rows are being written.
   */
  count?: number;
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
  // One pass over the events, not a filter per mode: each timestamp is parsed once.
  const inWindowCount = new Map<SessionBucket, number>();
  const mostRecentTime = new Map<SessionBucket, number>();
  for (const event of events) {
    const time = new Date(event.timestamp).getTime();
    const latest = mostRecentTime.get(event.mode);
    if (latest === undefined || time > latest) mostRecentTime.set(event.mode, time);
    if (time >= windowStart) {
      inWindowCount.set(event.mode, (inWindowCount.get(event.mode) ?? 0) + (event.count ?? 1));
    }
  }
  const distribution = {} as ActivityDistribution;
  for (const mode of ALL_SESSION_BUCKETS) {
    const mostRecent = mostRecentTime.get(mode);
    distribution[mode] = {
      count: inWindowCount.get(mode) ?? 0,
      daysSinceLast:
        mostRecent === undefined ? null : (now.getTime() - mostRecent) / (24 * 60 * 60 * 1000),
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
  /**
   * Set only for a `grammarPattern` subject whose pattern occurs in a
   * sentence where a `sentence_transformation` card was just missed twice
   * in a row — the conjugation form that tripped the learner up is
   * (probably) part of the construction this card tests. The
   * `sentence_transformation`/grammar half of "cross-activity error
   * routing" (docs/ROADMAP.md "Possibilities"); the `pitch_accent` half
   * shipped 2026-09-11 as its own focus queue instead of a priority nudge,
   * since a due `grammar_completion` item is already in this ranked batch
   * and doesn't need a separate surface. Never makes a not-due item due —
   * only reorders among what's already here.
   */
  crossActivityMissBoost?: boolean;
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

  const score =
    forgettingRisk * usefulness * staleness + weakness * 0.5 + (input.crossActivityMissBoost ? 0.4 : 0);

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
  if (input.crossActivityMissBoost) reasons.push('linked to a recently missed conjugation');

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
  /** Max multiple of a mode's own fair share it can reach via redistribution (default REDISTRIBUTION_MAX_SHARE_MULTIPLE) — bounds how far freed minutes can override the learner's split. */
  redistributionCap?: number;
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

  // A mode's effective ceiling is the smaller of what its candidate list can
  // spend (availableMinutesByMode) and `redistributionCap` x its own fair
  // share of the requested time — the latter stops minutes freed by a capped
  // bucket from piling into one down-weighted bucket that happens to still
  // have candidates (see REDISTRIBUTION_MAX_SHARE_MULTIPLE).
  const totalWeight = ALL_SESSION_BUCKETS.reduce((sum, mode) => sum + (weights.get(mode) ?? 0), 0);
  const capMultiple = input.redistributionCap ?? REDISTRIBUTION_MAX_SHARE_MULTIPLE;
  const effectiveCeiling = (mode: SessionBucket): number | undefined => {
    const candidateCeiling = input.availableMinutesByMode?.[mode];
    const fairShareCap =
      totalWeight > 0
        ? capMultiple * input.totalMinutes * ((weights.get(mode) ?? 0) / totalWeight)
        : undefined;
    if (candidateCeiling === undefined) return fairShareCap;
    if (fairShareCap === undefined) return candidateCeiling;
    return Math.min(candidateCeiling, fairShareCap);
  };

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
      const ceiling = effectiveCeiling(mode);
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

  // When every mode has hit its ceiling there may be minutes left that
  // nothing can absorb (thin due queue, few candidates, and/or the learner
  // zeroed a bucket in their split). Round against what was actually
  // allocated, not input.totalMinutes — otherwise roundAllocation would dump
  // the whole unallocatable remainder onto the largest bucket, re-inflating
  // exactly the bucket (usually shadowing) this ceiling logic is meant to
  // bound. The session simply comes back shorter than requested; the
  // explanation says why (see buildRecommendedSession).
  const allocatedTotal = ALL_SESSION_BUCKETS.reduce(
    (sum, mode) => sum + (allocation.get(mode) ?? 0),
    0,
  );
  return roundAllocation(allocation, allocatedTotal);
}

// ---------------------------------------------------------------------------
// Steps 4/7/8: candidate activities and concrete step selection
// ---------------------------------------------------------------------------

export interface DueBatchCandidate {
  priorities: ReviewPriorityResult[];
}

/** A walked-through sentence whose next Read check is due (see src/lib/readCheck.ts). */
export interface ReadCheckCandidate {
  bookId: string;
  sentenceId: string;
  preview: string;
  reason: string;
  /** Sentences due in all (this list is trimmed), for the "N waiting" nudge on the first step. */
  waiting: number;
}

/** A sentence due for an Ear tiles or Dictation round in the reader (see src/lib/listeningTools.ts). */
export interface ListeningToolCandidate {
  bookId: string;
  sentenceId: string;
  preview: string;
  reason: string;
  tool: 'tiles' | 'dictate';
}

/** A walked-through sentence due for a Word check in the reader (see src/lib/wordCheckSteps.ts). */
export interface WordCheckCandidate {
  bookId: string;
  sentenceId: string;
  preview: string;
  reason: string;
}

export interface ExploreCandidate {
  bookId: string;
  label: string;
  reason: string;
  /** Ordered next unstarted sentences in this book, capped at EXPLORE_SENTENCE_PREVIEW_LIMIT — one step drafted per entry until the shared glossing budget runs out. */
  sentences: {
    sentenceId: string;
    preview: string;
    /** Walked through on an earlier day and not yet said independently — a fresh try, not a first lesson. */
    revisit?: boolean;
    /** A structure check was parked in this sentence; the revisit re-asks only that. */
    parkedGloss?: true;
    /** Words in this walked-through sentence the learner hasn't retained; why it was brought back (`getWeakWordSentenceSignal`). */
    weakWords?: string[];
    /** Grammar patterns in this walked-through sentence the learner hasn't retained (`getWeakGrammarSentenceSignal`). */
    weakGrammar?: string[];
    /** i+1 ordering only: this sentence's place in the order over every book (lower = sooner); new sentences are served across books by it. */
    iPlusOneRank?: number;
    /** i+1 ordering only: content words here the learner has not met yet (a few, for the lesson's reason line). */
    newWords?: string[];
  }[];
}

export interface ShadowCandidate {
  sentenceId: string;
  bookId?: string;
  label: string;
  reason: string;
  /** Drafted as a phrase shadow (mark a span and rate it) because whole-sentence shadowing is paused. */
  phrase?: boolean;
  /** The suggested phrase to shadow (from the cached alignment), when one could be worked out. */
  phraseText?: string;
}

/**
 * A sentence the learner has already worked through whose "Grammar noticed"
 * pass hasn't been marked done (`SentenceAnalysis.grammarReviewStatus !==
 * 'confirmed'`). Listed by the standalone `GrammarNoticingFlowPage`; the
 * planner no longer drafts steps for it.
 */
export interface GrammarNoticingCandidate {
  sentenceId: string;
  bookId?: string;
  label: string;
  reason: string;
}

/**
 * A `/play` game that can fill a round right now, offered to the planner as a
 * possible session break. The caller (which can see the game registry — this
 * module can't without a circular import) checks eligibility and orders the
 * list by preference; the planner takes the first few.
 */
export interface GameBreakCandidate {
  gameId: string;
  title: string;
  /** Short skill the game trains, for the step's reason line ("pitch listening"). */
  skill: string;
}

export interface SessionPlannerInput {
  now: Date;
  /** Minutes this planning pass has to work with — the day's starting budget on first plan, or just the increment being added on a later top-up (see `addMinutesToTodaySession`). */
  totalMinutes: number;
  recentActivity: RecentActivityEvent[];
  /** Due StudyItems costed at the quicker "retain" per-item rate (reading_in_context/listening/ear_tiles) — merged with practiceDue into one ranked `review` batch. */
  retainDue: ReviewPriorityInput[];
  /** Due StudyItems costed at the slower "practice" per-item rate (dictation tiles, pitch production) — merged with retainDue into one ranked `review` batch. */
  practiceDue: ReviewPriorityInput[];
  exploreCandidates: ExploreCandidate[];
  /** Sentences due for a Read check, most urgent first. Drafted into the `review` bucket (sentence cards are replaced by these). */
  readCheckCandidates?: ReadCheckCandidate[];
  /** Sentences due for an Ear tiles or Dictation round in the reader, most urgent first. Drafted into the `review` bucket after the Read checks. */
  listeningToolCandidates?: ListeningToolCandidate[];
  /** Sentences due for a Word check in the reader, most urgent first. Drafted into the `review` bucket ahead of the Read checks. */
  wordCheckCandidates?: WordCheckCandidate[];
  shadowCandidates: ShadowCandidate[];
  reviewLimit?: number;
  /** User-adjustable override for BASELINE_SESSION_ALLOCATION (set directly on Home) — see AllocateTimeInput.baseline. */
  baseline?: Record<SessionBucket, number>;
  /**
   * `settings.quietMode` — the learner can't speak aloud right now.
   * `getSessionPlannerInput` already withholds `shadowCandidates` when it's
   * set (so no shadowing steps get drafted and the minutes flow to the
   * other buckets); this flag only drives the explanation line.
   */
  quietMode?: boolean;
  /**
   * Playable short games, most-preferred first. Omitted/empty = no game
   * breaks. When present, each break's minutes are reserved out of
   * `totalMinutes` before the buckets split the rest (see `gameBreakCount`).
   */
  gameBreakCandidates?: GameBreakCandidate[];
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
  /** The `/play` game a `game` step opens. */
  gameId?: string;
  /** Sentences a batched step walks in one flow — currently only `grammar_noticing`. See PlannerSessionStep.sentenceIds. */
  sentenceIds?: string[];
  label: string;
  estimatedMinutes: number;
  reason: string;
  status: PlannerStepStatus;
  targetCount?: number;
  /** A Word check in the reader (see PlannerSessionStep.wordCheck), not a walkthrough. */
  wordCheck?: boolean;
  /** A Grammar check in the reader (see PlannerSessionStep.grammarCheck), not a walkthrough. */
  grammarCheck?: boolean;
  /** A Read check in the reader (see PlannerSessionStep.readCheck), not a walkthrough. */
  readCheck?: boolean;
  /** An Ear tiles or Dictation round in the reader (see PlannerSessionStep.readerTool). */
  readerTool?: 'tiles' | 'dictate';
  /** A phrase shadow (see PlannerSessionStep.phrase). */
  phrase?: boolean;
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
export function reviewItemCostMinutes(activityType: StudyActivityType): number {
  // pitch_accent_production is neither list (record -> align -> score is its
  // own, slower cost tier) — checked first so it doesn't silently fall into
  // the cheap retain default.
  if (activityType === 'pitch_accent_production') return MODE_ACTIVITY_ESTIMATE_MINUTES.pitchProduction;
  return PRACTICE_ACTIVITY_TYPE_SET.has(activityType)
    ? MODE_ACTIVITY_ESTIMATE_MINUTES.practice
    : MODE_ACTIVITY_ESTIMATE_MINUTES.retain;
}

/** Sum of per-item costs for the first `limit` ranked items — used both to build the actual step and to compute how many minutes the `review` bucket can actually absorb (see buildRecommendedSession's reviewCeiling). */
function reviewBatchCostMinutes(ranked: ReviewPriorityResult[], limit: number): number {
  return ranked.slice(0, limit).reduce((sum, item) => sum + reviewItemCostMinutes(item.activityType), 0);
}

/**
 * Step 7 (review bucket): several small batched steps of
 * `REVIEW_STEP_BATCH_SIZE` cards each, rather than one big "do N due
 * reviews" step (2026-09-22 — one giant step read as a long slog and left
 * `interleaveGameBreaks` nothing to actually interleave with, since it only
 * drops breaks *between* whole steps; see that constant's doc comment).
 * ReviewPage's own due queue is still the actual execution surface — these
 * are checkpoints the session settles and auto-advances through
 * (`countReviewsSince(step.startedAt)` in ReviewPage, already per-step, no
 * new machinery needed for several review-kind steps in one session).
 * Retain- and practice-costed items are ranked together (score doesn't care
 * which pool an item came from) and packed by walking the ranked list
 * summing each item's own cost, since the two pools cost different amounts
 * per item — a plain count-based pack would misprice a batch that's mostly
 * one type or the other.
 */
function buildReviewBatchSteps(
  ranked: ReviewPriorityResult[],
  budgetMinutes: number,
): PlannerStepDraft[] {
  let used = 0;
  const chosen: ReviewPriorityResult[] = [];
  for (const item of ranked) {
    const cost = reviewItemCostMinutes(item.activityType);
    if (used + cost > budgetMinutes) break;
    used += cost;
    chosen.push(item);
  }
  if (chosen.length === 0) return [];

  const batches: ReviewPriorityResult[][] = [];
  for (let index = 0; index < chosen.length; index += REVIEW_STEP_BATCH_SIZE) {
    batches.push(chosen.slice(index, index + REVIEW_STEP_BATCH_SIZE));
  }

  return batches.map((batch) => {
    const reasons = [...new Set(batch.flatMap((item) => item.reasons))].slice(0, 2);
    return {
      id: draftStepId(),
      bucket: 'review',
      activityType: 'due_review_batch',
      targetKind: 'review',
      label: `Review ${batch.length} high-priority item${batch.length === 1 ? '' : 's'}`,
      estimatedMinutes: batch.reduce((sum, item) => sum + reviewItemCostMinutes(item.activityType), 0),
      reason: reasons.length > 0 ? reasons.join(', ') : 'Due for review',
      status: 'pending',
      targetCount: batch.length,
    };
  });
}

/** Read check steps (one minute each) for the due sentences, within the review budget left after the card batches. */
function buildReadCheckSteps(candidates: readonly ReadCheckCandidate[], budgetMinutes: number): PlannerStepDraft[] {
  const steps: PlannerStepDraft[] = [];
  let remaining = budgetMinutes;
  for (const candidate of candidates.slice(0, READ_CHECK_STEPS_PER_PLAN)) {
    if (READ_CHECK_STEP_MINUTES > remaining) break;
    steps.push({
      id: draftStepId(),
      bucket: 'review',
      activityType: SYNTHETIC_ACTIVITY_TYPES.sentenceLearning,
      targetKind: 'sentence_learning',
      bookId: candidate.bookId,
      sentenceId: candidate.sentenceId,
      label: `Read check: ${candidate.preview}`,
      estimatedMinutes: READ_CHECK_STEP_MINUTES,
      reason:
        steps.length === 0 && candidate.waiting > 1
          ? `${candidate.reason} (${candidate.waiting} sentences waiting for a check)`
          : candidate.reason,
      status: 'pending',
      readCheck: true,
    });
    remaining -= READ_CHECK_STEP_MINUTES;
  }
  return steps;
}

/** Ear tiles / Dictation steps for the sentences due, within the review budget left after the Read checks. */
function buildListeningToolSteps(candidates: readonly ListeningToolCandidate[], budgetMinutes: number): PlannerStepDraft[] {
  const steps: PlannerStepDraft[] = [];
  let remaining = budgetMinutes;
  for (const candidate of candidates.slice(0, LISTENING_TOOL_STEPS_PER_PLAN)) {
    if (LISTENING_TOOL_STEP_MINUTES > remaining) break;
    steps.push({
      id: draftStepId(),
      bucket: 'review',
      activityType: SYNTHETIC_ACTIVITY_TYPES.sentenceLearning,
      targetKind: 'sentence_learning',
      bookId: candidate.bookId,
      sentenceId: candidate.sentenceId,
      label: `${candidate.tool === 'tiles' ? 'Ear tiles' : 'Dictation'}: ${candidate.preview}`,
      estimatedMinutes: LISTENING_TOOL_STEP_MINUTES,
      reason: candidate.reason,
      status: 'pending',
      readerTool: candidate.tool,
    });
    remaining -= LISTENING_TOOL_STEP_MINUTES;
  }
  return steps;
}

/** Word check steps for the sentences due, within the review budget left after the card batches. */
function buildWordCheckSteps(candidates: readonly WordCheckCandidate[], budgetMinutes: number): PlannerStepDraft[] {
  const steps: PlannerStepDraft[] = [];
  let remaining = budgetMinutes;
  for (const candidate of candidates.slice(0, WORD_CHECK_STEPS_PER_PLAN)) {
    if (WORD_CHECK_STEP_MINUTES > remaining) break;
    steps.push({
      id: draftStepId(),
      bucket: 'review',
      activityType: SYNTHETIC_ACTIVITY_TYPES.sentenceLearning,
      targetKind: 'sentence_learning',
      bookId: candidate.bookId,
      sentenceId: candidate.sentenceId,
      label: `Word check: ${candidate.preview}`,
      estimatedMinutes: WORD_CHECK_STEP_MINUTES,
      reason: candidate.reason,
      status: 'pending',
      wordCheck: true,
    });
    remaining -= WORD_CHECK_STEP_MINUTES;
  }
  return steps;
}

interface ExploreSentenceEntry {
  candidate: ExploreCandidate;
  sentence: ExploreCandidate['sentences'][number];
}

/** Every candidate sentence as a lesson entry: revisits (a second look at something already walked through) first, then first lessons. */
function classifyExploreSentences(candidates: ExploreCandidate[]): ExploreSentenceEntry[] {
  const entries: ExploreSentenceEntry[] = candidates.flatMap((candidate) =>
    candidate.sentences.map((sentence) => ({ candidate, sentence })),
  );
  return [...entries.filter((e) => e.sentence.revisit), ...mergeByIPlusOneRank(entries.filter((e) => !e.sentence.revisit))];
}

/**
 * i+1 ordering ranks new sentences across every book. Each book's own order
 * (already ranked, then adjusted for Sentence Growth) is kept; books are merged
 * by whichever next sentence ranks soonest. Without ranks (setting off) the
 * book-then-position order is returned unchanged.
 */
function mergeByIPlusOneRank(entries: ExploreSentenceEntry[]): ExploreSentenceEntry[] {
  if (!entries.some((entry) => entry.sentence.iPlusOneRank !== undefined)) return entries;
  const queues = new Map<ExploreCandidate, ExploreSentenceEntry[]>();
  for (const entry of entries) queues.set(entry.candidate, [...(queues.get(entry.candidate) ?? []), entry]);
  const rankOf = (entry: ExploreSentenceEntry) => entry.sentence.iPlusOneRank ?? Infinity;
  const merged: ExploreSentenceEntry[] = [];
  while (merged.length < entries.length) {
    let best: ExploreSentenceEntry[] | undefined;
    for (const queue of queues.values()) {
      if (queue.length > 0 && (!best || rankOf(queue[0]!) < rankOf(best[0]!))) best = queue;
    }
    merged.push(best!.shift()!);
  }
  return merged;
}

function exploreEntryCost(entry: ExploreSentenceEntry): number {
  return entry.sentence.revisit ? EXPLORE_STEP_MINUTES.revisit : EXPLORE_STEP_MINUTES.lesson;
}

function exploreStepFor(entry: ExploreSentenceEntry): PlannerStepDraft {
  const { candidate, sentence } = entry;
  return {
    id: draftStepId(),
    bucket: 'glossing',
    activityType: SYNTHETIC_ACTIVITY_TYPES.sentenceLearning,
    targetKind: 'sentence_learning',
    bookId: candidate.bookId,
    sentenceId: sentence.sentenceId,
    label: `${sentence.revisit ? 'Fresh try' : 'Learn this sentence'}: ${sentence.preview}`,
    estimatedMinutes: exploreEntryCost(entry),
    reason: sentence.parkedGloss
      ? `You parked a structure check in this sentence in ${candidate.label} — try it again`
      : sentence.revisit && sentence.weakWords?.length
      ? `Has words that haven't stuck: ${sentence.weakWords.join('、')} — walk through it again`
      : sentence.revisit && sentence.weakGrammar?.length
      ? `Has grammar that hasn't stuck: ${sentence.weakGrammar.join('、')} — walk through it again`
      : sentence.revisit
      ? `You walked through this in ${candidate.label} on an earlier day — try saying it without cues`
      : `Next sentence in ${candidate.label}${sentence.newWords?.length ? ` (new here: ${sentence.newWords.join('、')})` : ''} — walk through it, practise a target, then try saying it`,
    status: 'pending',
    ...(sentence.revisit ? { revisit: true } : {}),
  };
}

/**
 * Step 7 (glossing): one lesson per candidate sentence, revisits first, in the
 * order `classifyExploreSentences` gives, until the budget runs out. Keeps
 * scanning past a step that doesn't fit, since a cheaper one may still.
 */
function buildExploreSteps(candidates: ExploreCandidate[], budgetMinutes: number): PlannerStepDraft[] {
  const entries = classifyExploreSentences(candidates);
  const steps: PlannerStepDraft[] = [];
  const consumed = new Set<ExploreSentenceEntry>();
  let remaining = budgetMinutes;
  for (const entry of entries) {
    const cost = exploreEntryCost(entry);
    if (cost > remaining) continue;
    steps.push(exploreStepFor(entry));
    consumed.add(entry);
    remaining -= cost;
  }

  // Grammar checks: the grammar twin, for sentences brought back for patterns that haven't stuck.
  let grammarChecks = 0;
  for (const entry of entries) {
    if (grammarChecks >= GRAMMAR_CHECK_STEPS_PER_PLAN) break;
    if (!consumed.has(entry) || !isGrammarCheckCandidate(entry)) continue;
    if (EXPLORE_STEP_MINUTES.grammarCheck > remaining) break;
    steps.push(grammarCheckStepFor(entry));
    remaining -= EXPLORE_STEP_MINUTES.grammarCheck;
    grammarChecks += 1;
  }

  return steps;
}

function grammarCheckStepFor(entry: ExploreSentenceEntry): PlannerStepDraft {
  const { candidate, sentence } = entry;
  return {
    id: draftStepId(),
    bucket: 'glossing',
    activityType: SYNTHETIC_ACTIVITY_TYPES.sentenceLearning,
    targetKind: 'sentence_learning',
    bookId: candidate.bookId,
    sentenceId: sentence.sentenceId,
    label: `Grammar check: ${sentence.preview}`,
    estimatedMinutes: EXPLORE_STEP_MINUTES.grammarCheck,
    reason: `Recall what the grammar here does (${sentence.weakGrammar!.join('、')} hasn't stuck) — you judge how it went`,
    status: 'pending',
    grammarCheck: true,
  };
}

function isGrammarCheckCandidate(entry: ExploreSentenceEntry): boolean {
  return !!entry.sentence.revisit && !!entry.sentence.weakGrammar?.length;
}

/**
 * How many minutes the glossing bucket could actually absorb given its
 * candidate sentences: the sum of every sentence's step cost, unbounded by
 * budget. Feeds allocateTimeAcrossModes' availableMinutesByMode so a thin
 * candidate list doesn't attract redistributed spillover minutes it can't spend.
 */
function exploreCeilingMinutes(candidates: ExploreCandidate[]): number {
  const entries = classifyExploreSentences(candidates);
  const lessons = entries.reduce((total, entry) => total + exploreEntryCost(entry), 0);
  // Grammar checks ride on weak-grammar revisits (see buildExploreSteps); count the ones that can be drafted.
  const grammarChecks = Math.min(GRAMMAR_CHECK_STEPS_PER_PLAN, entries.filter(isGrammarCheckCandidate).length);
  return lessons + grammarChecks * EXPLORE_STEP_MINUTES.grammarCheck;
}

/**
 * Human-readable "how much have I shadowed this sentence" line, shared by the
 * planner (frozen into `step.reason` at plan time) and the session runner
 * (recomputed live from the current attempt count, so the card stops saying
 * "Not shadowed yet" once an attempt has actually been recorded).
 */
export function shadowAttemptSummary(attemptCount: number): string {
  return attemptCount === 0
    ? 'Not shadowed yet'
    : `Shadowed ${attemptCount}x so far`;
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
      label: candidate.phrase
        ? candidate.phraseText
          ? `Shadow a phrase: ${candidate.phraseText}`
          : `Shadow a phrase from: ${candidate.label}`
        : `Shadow: ${candidate.label}`,
      estimatedMinutes: perItemMinutes,
      reason: candidate.phrase
        ? `${candidate.reason} — ${candidate.phraseText ? 'use the suggested phrase' : 'mark a phrase'}, shadow it, then rate it`
        : candidate.reason,
      status: 'pending',
      ...(candidate.phrase ? { phrase: true } : {}),
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

/**
 * How many game breaks a pass of `totalMinutes` gets: one per
 * GAME_BREAK_INTERVAL_MINUTES, capped, and never more than there are distinct
 * playable games (a session doesn't offer the same game twice back to back).
 */
export function gameBreakCount(totalMinutes: number, candidateCount: number): number {
  if (candidateCount <= 0 || totalMinutes < GAME_BREAK_INTERVAL_MINUTES) return 0;
  return Math.min(
    Math.floor(totalMinutes / GAME_BREAK_INTERVAL_MINUTES),
    GAME_BREAK_MAX_PER_PASS,
    candidateCount,
  );
}

function buildGameBreakSteps(candidates: GameBreakCandidate[], count: number): PlannerStepDraft[] {
  return candidates.slice(0, count).map((game) => ({
    id: draftStepId(),
    // A step needs a bucket; games are not one of the four activities the
    // learner sets shares for, so they ride on `review` (the catch-all
    // practice bucket) and the recap breaks them out by `targetKind`.
    bucket: 'review' as const,
    activityType: SYNTHETIC_ACTIVITY_TYPES.gameBreak,
    targetKind: 'game' as const,
    gameId: game.gameId,
    label: `Game break: ${game.title}`,
    estimatedMinutes: GAME_BREAK_MINUTES,
    reason: `A short round that still trains ${game.skill}`,
    status: 'pending' as const,
  }));
}

/**
 * Spread game breaks through the ordered steps — one after each equal slice of
 * the step time — so they read as breaks rather than a block of games at the
 * end. Never first (the session should start with real work) unless there is
 * nothing else to do.
 */
function interleaveGameBreaks(
  steps: PlannerStepDraft[],
  breaks: PlannerStepDraft[],
): PlannerStepDraft[] {
  if (breaks.length === 0) return steps;
  if (steps.length === 0) return breaks;
  const totalMinutes = steps.reduce((sum, step) => sum + step.estimatedMinutes, 0);
  const slice = totalMinutes / (breaks.length + 1);
  const result: PlannerStepDraft[] = [];
  let elapsed = 0;
  let nextBreak = 0;
  for (const step of steps) {
    result.push(step);
    elapsed += step.estimatedMinutes;
    while (nextBreak < breaks.length && elapsed >= slice * (nextBreak + 1)) {
      result.push(breaks[nextBreak]!);
      nextBreak += 1;
    }
  }
  // Any left over (rounding, or one step swallowed several slices) go last.
  result.push(...breaks.slice(nextBreak));
  return result;
}

function explainNeglect(
  neglectScores: NeglectScores,
  distribution: ActivityDistribution,
  allocation: Record<SessionBucket, number>,
  baseline: Record<SessionBucket, number>,
): string[] {
  const explanations: string[] = [];
  const sortedByNeglect = [...ALL_SESSION_BUCKETS].sort(
    (a, b) => neglectScores[b] - neglectScores[a],
  );
  const mostNeglected = sortedByNeglect[0]!;
  const plannedTotal = ALL_SESSION_BUCKETS.reduce((sum, mode) => sum + allocation[mode], 0);
  const neglectedShare = plannedTotal > 0 ? allocation[mostNeglected] / plannedTotal : 0;
  const baselineTotal = ALL_SESSION_BUCKETS.reduce((sum, mode) => sum + baseline[mode], 0);
  const neglectedBaselineShare =
    baselineTotal > 0 ? baseline[mostNeglected] / baselineTotal : 0;
  // Only claim the session "emphasizes" the neglected bucket when it
  // actually got a bigger-than-baseline slice — otherwise (the learner
  // zeroed it in their split, or there were no candidates for it) the
  // message is just wrong.
  if (neglectScores[mostNeglected] >= 0.7 && neglectedShare > neglectedBaselineShare) {
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
    case 'grammar_noticing': {
      // New batched form: walk every sentence in one flow.
      if (step.sentenceIds && step.sentenceIds.length > 0) {
        return `/notice-grammar?ids=${step.sentenceIds.join(',')}`;
      }
      // Older persisted sessions drafted one step per sentence, deep-linking
      // straight into that sentence's Analyze grammar panel.
      return step.bookId && step.sentenceId
        ? `/books/${step.bookId}/analyze/${step.sentenceId}`
        : null;
    }
    case 'shadow':
      // Shadowing opens in the reader (docked panel); /shadow/:sentenceId still serves the standalone page.
      return step.bookId && step.sentenceId
        ? `/books/${step.bookId}/speak/${step.sentenceId}`
        : null;
    case 'review':
      return step.bookId ? `/books/${step.bookId}/review` : '/review';
    case 'vocabulary_detail':
      return '/vocabulary';
    case 'sentence_learning':
      if (!step.bookId || !step.sentenceId) return null;
      // A Word check opens the reader with that sentence's word check ready; query-free like every step path.
      if (step.readCheck) return `/books/${step.bookId}/recall/${step.sentenceId}`;
      if (step.readerTool) return `/books/${step.bookId}/${step.readerTool}/${step.sentenceId}`;
      if (step.grammarCheck) return `/books/${step.bookId}/grammar-check/${step.sentenceId}`;
      return step.wordCheck
        ? `/books/${step.bookId}/check/${step.sentenceId}`
        : `/books/${step.bookId}/learn/${step.sentenceId}`;
    case 'game':
      // Query-free on purpose: useActiveSession matches a step's page by exact pathname.
      return step.gameId ? `/play/${step.gameId}/auto` : null;
  }
}

export function buildRecommendedSession(input: SessionPlannerInput): RecommendedSession {
  const gameBreaks = gameBreakCount(input.totalMinutes, input.gameBreakCandidates?.length ?? 0);
  const gameMinutes = gameBreaks * GAME_BREAK_MINUTES;
  // The buckets split what's left after the breaks, so the whole plan still
  // adds up to the time the learner asked for.
  const totalMinutes = input.totalMinutes - gameMinutes;
  const reviewLimit = input.reviewLimit ?? REVIEW_PRIORITY_DEFAULT_LIMIT;

  const distribution = computeRecentActivityDistribution(input.recentActivity, input.now);
  const neglectScores = computeNeglectScores(distribution);

  // retainDue/practiceDue are ranked together — the score doesn't care which
  // pool an item came from, and ReviewPage itself doesn't distinguish them
  // either (one shared due-queue). reviewLimit still caps the combined pool
  // to "the best N," not both pools' worth.
  const rankedReview = rankReviewPriorities([...input.retainDue, ...input.practiceDue], reviewLimit);
  const readCheckMinutes =
    Math.min(READ_CHECK_STEPS_PER_PLAN, input.readCheckCandidates?.length ?? 0) * READ_CHECK_STEP_MINUTES;
  const listeningToolMinutes =
    Math.min(LISTENING_TOOL_STEPS_PER_PLAN, input.listeningToolCandidates?.length ?? 0) * LISTENING_TOOL_STEP_MINUTES;
  const wordCheckMinutes =
    Math.min(WORD_CHECK_STEPS_PER_PLAN, input.wordCheckCandidates?.length ?? 0) * WORD_CHECK_STEP_MINUTES;
  const reviewCeiling =
    reviewBatchCostMinutes(rankedReview, reviewLimit) + readCheckMinutes + wordCheckMinutes + listeningToolMinutes;

  // Every bucket — not just review — is clamped to what its candidate list
  // can actually spend. Without this, minutes freed by a capped bucket get
  // redistributed to the others by weight regardless of whether they have
  // material for them, which is how a thin due queue used to turn into a
  // session of ~10 shadowing reps even when the learner set shadowing to a
  // small share (2026-08-27).
  const allocation = allocateTimeAcrossModes({
    totalMinutes,
    neglectScores,
    baseline: input.baseline,
    availableMinutesByMode: {
      glossing: exploreCeilingMinutes(input.exploreCandidates),
      // Nothing is drafted into the grammar bucket any more (Grammar checks ride in glossing).
      grammar: 0,
      shadowing: input.shadowCandidates.length * MODE_ACTIVITY_ESTIMATE_MINUTES.shadowing,
      review: reviewCeiling,
    },
  });

  const reviewBatchSteps = buildReviewBatchSteps(rankedReview, allocation.review);

  const shadowSteps = buildShadowSteps(
    input.shadowCandidates,
    allocation.shadowing,
    MODE_ACTIVITY_ESTIMATE_MINUTES.shadowing,
  );

  const exploreSteps = buildExploreSteps(input.exploreCandidates, allocation.glossing);
  // One tool per sentence per plan: a sentence drafted for a Fresh try (a full walkthrough) gets no check in
  // the same plan. Word checks go first (the meaning step comes before the next unaided read), then Read
  // checks, then listening steps, each skipping sentences an earlier one took; a skipped sentence stays due.
  const taken = new Set(exploreSteps.filter((step) => step.targetKind === 'sentence_learning').map((step) => step.sentenceId));
  const untaken = <T extends { sentenceId: string }>(candidates: readonly T[] | undefined): T[] =>
    (candidates ?? []).filter((candidate) => !taken.has(candidate.sentenceId));
  const spent = (steps: readonly PlannerStepDraft[]) => steps.reduce((sum, step) => sum + step.estimatedMinutes, 0);
  let reviewLeft = allocation.review - spent(reviewBatchSteps);
  const wordCheckSteps = buildWordCheckSteps(untaken(input.wordCheckCandidates), reviewLeft);
  reviewLeft -= spent(wordCheckSteps);
  for (const step of wordCheckSteps) taken.add(step.sentenceId);
  const readCheckSteps = buildReadCheckSteps(untaken(input.readCheckCandidates), reviewLeft);
  reviewLeft -= spent(readCheckSteps);
  for (const step of readCheckSteps) taken.add(step.sentenceId);
  const listeningToolSteps = buildListeningToolSteps(untaken(input.listeningToolCandidates), reviewLeft);
  const reviewSteps = [...reviewBatchSteps, ...wordCheckSteps, ...readCheckSteps, ...listeningToolSteps];
  const allSteps = [
    ...exploreSteps,
    ...shadowSteps,
    ...reviewSteps,
  ];
  const { steps: chainedSteps, chainedSentenceIds } = preferCoherentChains(allSteps);
  const orderedSteps = interleaveGameBreaks(
    chainedSteps,
    buildGameBreakSteps(input.gameBreakCandidates ?? [], gameBreaks),
  );

  const explanation = explainNeglect(
    neglectScores,
    distribution,
    allocation,
    input.baseline ?? BASELINE_SESSION_ALLOCATION,
  );
  if (input.quietMode) {
    explanation.push('Quiet mode is on — speaking practice (shadowing) is paused for now.');
  }
  if (
    reviewCeiling < allocation.review + MODE_ACTIVITY_ESTIMATE_MINUTES.retain &&
    rankedReview.length < reviewLimit
  ) {
    explanation.push("No large review backlog right now, so review is a small part of today's plan.");
  }
  if (readCheckSteps.length > 0) {
    const waiting = readCheckSteps.length > 0 ? input.readCheckCandidates![0]!.waiting : 0;
    explanation.push(
      `${waiting} walked-through sentence${waiting === 1 ? ' is' : 's are'} due for a Read check; ${readCheckSteps.length} ${readCheckSteps.length === 1 ? 'is' : 'are'} in today's plan.`,
    );
  }
  const plannedMinutes = ALL_SESSION_BUCKETS.reduce((sum, mode) => sum + allocation[mode], 0);
  if (gameBreaks > 0) {
    explanation.push(
      `${gameBreaks} short game break${gameBreaks === 1 ? '' : 's'} (~${Math.round(gameMinutes)} min) ${gameBreaks === 1 ? 'is' : 'are'} counted inside your ${Math.round(input.totalMinutes)} min.`,
    );
  }
  if (plannedMinutes < totalMinutes - MODE_ACTIVITY_ESTIMATE_MINUTES.grammar) {
    explanation.push(
      `Your due queue and new-material lists only add up to about ${Math.round(plannedMinutes + gameMinutes)} min right now, so today's plan is shorter than the ${Math.round(input.totalMinutes)} you asked for.`,
    );
  }
  if (chainedSentenceIds.length > 0) {
    explanation.push('Some steps below share the same sentence, so they run back to back.');
  }
  if (orderedSteps.length === 0) {
    const baseline = input.baseline ?? BASELINE_SESSION_ALLOCATION;
    const withShare = ALL_SESSION_BUCKETS.filter((bucket) => (baseline[bucket] ?? 0) > 0);
    if (input.quietMode && withShare.length > 0 && withShare.every((bucket) => bucket === 'shadowing')) {
      explanation.push(
        'Nothing was planned: your split gives all the time to shadowing, and quiet mode has shadowing paused. Give another activity a share under "Customize split", or turn quiet mode off.',
      );
    } else if (withShare.length > 0) {
      explanation.push(
        `Nothing was planned: none of the activities your split gives time to (${withShare.join(', ')}) has anything to offer right now. Try a share for another activity under "Customize split".`,
      );
    } else {
      explanation.push('Nothing was planned: your split gives no activity any time. Set a share under "Customize split".');
    }
  }
  if (explanation.length === 0) {
    explanation.push('A balanced mix across glossing, grammar, shadowing, and review.');
  }

  return {
    targetMinutes: input.totalMinutes,
    allocation,
    neglectScores,
    steps: orderedSteps,
    explanation,
  };
}
