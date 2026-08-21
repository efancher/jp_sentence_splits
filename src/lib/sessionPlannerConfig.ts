import type { LearningMode, SessionLength, StudyActivityType } from '../domain/types';

/**
 * Tunable constants for the Learning Orchestrator (docs/AI_OVERVIEW.md).
 * Every number a future tuning pass might want to change lives here, not
 * scattered through sessionPlanner.ts — see docs/AI_OVERVIEW.md's Learning
 * Orchestrator section for what each one does to the recommendation.
 */

export const SESSION_LENGTH_MINUTES: Record<SessionLength, number> = {
  quick: 10,
  normal: 30,
  deep: 60,
};

/** Prompt's own starting heuristic for a Normal session — a guideline, not a quota (see allocateTimeAcrossModes). */
export const BASELINE_MODE_ALLOCATION: Record<LearningMode, number> = {
  explore: 0.35,
  understand: 0.2,
  practice: 0.2,
  retain: 0.25,
};

/**
 * Which mode each real StudyActivityType belongs to, for attributing past
 * Review rows to a mode (recent-activity distribution) and for labeling
 * candidate steps. Recognition/comprehension-style activities are Retain;
 * production/active-use activities are Practice, even though several of
 * them (cloze, sentence_transformation, grammar_completion/contrast) are
 * also FSRS-scheduled StudyItems like Retain's — the taxonomy is a
 * scheduling/analytics lens on top of the existing activity types, not a
 * new activity-type split (prompt point 1: "do not force all functionality
 * into this taxonomy").
 */
export const ACTIVITY_TYPE_MODE: Record<StudyActivityType, LearningMode> = {
  comprehension: 'retain',
  reading_in_context: 'retain',
  reading_retrieval: 'retain',
  listening: 'retain',
  grammar_comprehension: 'retain',
  cloze: 'practice',
  reading_production: 'practice',
  sentence_transformation: 'practice',
  contrastive: 'practice',
  grammar_completion: 'practice',
  grammar_contrast: 'practice',
};

/** Real StudyActivityTypes counted toward Retain-mode candidate selection/activity distribution. */
export const RETAIN_ACTIVITY_TYPES: StudyActivityType[] = [
  'comprehension',
  'reading_in_context',
  'reading_retrieval',
  'listening',
  'grammar_comprehension',
];

/** Real StudyActivityTypes counted toward Practice-mode candidate selection/activity distribution. */
export const PRACTICE_ACTIVITY_TYPES: StudyActivityType[] = [
  'cloze',
  'reading_production',
  'sentence_transformation',
  'contrastive',
  'grammar_completion',
  'grammar_contrast',
];

/** Synthetic (non-StudyItem) activity labels the planner itself invents for Explore/Understand/shadowing steps. */
export const SYNTHETIC_ACTIVITY_TYPES = {
  newSentence: 'new_sentence',
  grammarExplore: 'grammar_explore',
  shadowingPractice: 'shadowing_practice',
} as const;

/** Rough minutes-per-item used to pack a mode's time budget into concrete steps — deliberately coarse (prompt point 10 prefers estimates over new time-tracking infrastructure). */
export const MODE_ACTIVITY_ESTIMATE_MINUTES: Record<LearningMode, number> = {
  explore: 2.5,
  understand: 2,
  practice: 1.5,
  retain: 0.75,
};

/** Rolling window (days) recent-activity distribution and neglect are computed over — prompt point 6's "7- or 14-day view." */
export const NEGLECT_WINDOW_DAYS = 14;

/** How strongly a fully-neglected mode (untouched for the whole window) can pull the baseline allocation toward itself — a fraction added on top of its baseline share before renormalizing, so the baseline is nudged, not overridden. */
export const MAX_NEGLECT_BOOST = 0.6;

/** A subject with no re-encounter signal for this many days starts losing review priority (prompt point 4's "gradually reducing review priority for items mined once long ago and never re-encountered"). Never reaches zero — see STALE_PRIORITY_FLOOR. */
export const STALE_REENCOUNTER_DAYS = 30;

/** Floor on the stale-item priority decay factor — an old, never-re-encountered item still gets *some* priority, it's just deprioritized relative to actively-recurring material. Matches the "do not silently delete user data" requirement: nothing is ever fully zeroed out. */
export const STALE_PRIORITY_FLOOR = 0.25;

/** Default cap on how many due reviews a session actually includes, regardless of how large the due queue is (prompt point 4: "choose the best 10-15 reviews... not the entire due queue"). */
export const REVIEW_PRIORITY_DEFAULT_LIMIT = 15;

/** How many due StudyItems per mode are fetched (already due-date sorted) before scoring — bounds the cost of the per-candidate diversity/history lookups regardless of total due-queue size. */
export const SESSION_PLANNER_CANDIDATE_POOL_SIZE = 60;

/** How many books' "continue reading" Explore candidates to consider. */
export const EXPLORE_CANDIDATE_LIMIT = 5;

/** How many not-yet-tracked grammar patterns to consider as Understand candidates. */
export const UNDERSTAND_CANDIDATE_LIMIT = 8;

/** How many shadowing candidates to consider. */
export const SHADOW_CANDIDATE_LIMIT = 10;

/**
 * Minimum share of the Practice allocation reserved for shadowing, claimed
 * before the due-practice batch (cloze/production/etc reviews) gets its cut
 * — without a reserve, a due-practice backlog can crowd shadowing out of
 * every session's recommendation, since the batch step was built first and
 * shadowing only got whatever minutes were left. Still leftover-friendly:
 * if the due batch doesn't use its capped share, the unused time still
 * rolls over to shadowing rather than sitting idle.
 */
export const SHADOW_MIN_SHARE_OF_PRACTICE = 1 / 3;

/** How many of a learner's most-recently-opened, non-archived books count as "in scope" for shadowing candidates. */
export const SHADOW_ACTIVE_BOOK_LIMIT = 5;
