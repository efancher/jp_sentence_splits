import type { SessionBucket, StudyActivityType } from '../domain/types';

/**
 * Tunable constants for the Learning Orchestrator (docs/AI_OVERVIEW.md).
 * Every number a future tuning pass might want to change lives here, not
 * scattered through sessionPlanner.ts — see docs/AI_OVERVIEW.md's Learning
 * Orchestrator section for what each one does to the recommendation.
 */

/** Starting budget for a brand-new daily session, before any top-up (design: "assume about an hour a day"). */
export const DEFAULT_DAILY_BUDGET_MINUTES = 60;

/** "I have a bit more time" top-up amounts offered on Home, smallest first. */
export const TOP_UP_INCREMENTS_MINUTES = [20, 30] as const;

/**
 * The four concrete activities a session's time is split across (follow-up,
 * 2026-08-26) — replaces an earlier abstract Explore/Understand/Practice/
 * Retain taxonomy that user feedback found not concrete enough to reason
 * about directly. `glossing` = new-sentence structural analysis + vocab
 * confirmation, `grammar` = examining not-yet-tracked grammar patterns,
 * `shadowing` = pronunciation practice, `review` = every FSRS due card
 * (comprehension/cloze/production/pitch/grammar drills/etc. — one shared
 * due-queue, so one bucket) regardless of which of the old two "halves"
 * (retain/practice) it used to belong to. See src/lib/sessionPlanner.ts's
 * ALL_SESSION_BUCKETS for the canonical ordered list.
 */

/** Starting heuristic split across the four buckets — a guideline, not a quota (see allocateTimeAcrossModes), user-adjustable on Home before adding time. */
export const BASELINE_SESSION_ALLOCATION: Record<SessionBucket, number> = {
  glossing: 0.35,
  grammar: 0.15,
  shadowing: 0.15,
  review: 0.35,
};

/**
 * Real StudyActivityTypes eligible for the `review` bucket's "recognition-
 * style" half — costed at MODE_ACTIVITY_ESTIMATE_MINUTES.retain per item
 * (quicker: show/reveal/self-rate).
 */
export const RETAIN_ACTIVITY_TYPES: StudyActivityType[] = [
  'comprehension',
  'reading_in_context',
  'reading_retrieval',
  'listening',
  'word_listening',
  'grammar_comprehension',
];

/**
 * Real StudyActivityTypes eligible for the `review` bucket's "production-
 * style" half — costed at MODE_ACTIVITY_ESTIMATE_MINUTES.practice per item
 * (slower: typed/produced answers). Both halves are ranked and packed
 * together into one combined `review` batch step (2026-08-26 follow-up) —
 * this split only matters for per-item time-cost lookup and the due-item
 * fetch now, not for a separate top-level allocation.
 */
export const PRACTICE_ACTIVITY_TYPES: StudyActivityType[] = [
  'cloze',
  'reading_production',
  'sentence_transformation',
  'contrastive',
  'grammar_completion',
  'grammar_contrast',
];

/** Synthetic (non-StudyItem) activity labels the planner itself invents for glossing/grammar/shadowing steps. */
export const SYNTHETIC_ACTIVITY_TYPES = {
  newSentence: 'new_sentence',
  vocabularyReview: 'vocabulary_review',
  grammarExplore: 'grammar_explore',
  shadowingPractice: 'shadowing_practice',
} as const;

/** Rough minutes-per-item used to pack a bucket's time budget into concrete steps — deliberately coarse (prompt point 10 prefers estimates over new time-tracking infrastructure). Keys are internal cost tiers, not 1:1 with SessionBucket (the `review` bucket draws on both `retain`/`practice` costs, see RETAIN_ACTIVITY_TYPES/PRACTICE_ACTIVITY_TYPES above). */
export const MODE_ACTIVITY_ESTIMATE_MINUTES = {
  glossing: 2.5,
  grammar: 2,
  // A shadowing rep is listen -> record -> compare waveform/pitch -> usually
  // repeat a few times; 1.5 min badly undercounted it and let the bucket
  // balloon whenever spillover minutes had nowhere else to go (2026-08-27).
  shadowing: 3.5,
  retain: 0.75,
  practice: 1.5,
} as const;

/** Per-sentence cost of a single glossing step — `vocabulary_review` (a not-yet-confirmed sentence) or `continue_book` (a sentence whose vocabulary is confirmed and proficient), never both in the same pass, see buildExploreSteps. */
export const EXPLORE_STEP_MINUTES = { analyze: 1.5, vocabulary: 1 } as const;

/**
 * Minimum share of the glossing bucket's minutes that vocabulary
 * confirmations (`vocabulary_review`) get first claim on, whenever any
 * not-yet-confirmed sentence is a candidate (user request, 2026-08-29).
 * buildExploreSteps spends up to this fraction on confirmations before it
 * drafts a single `continue_book` structural-analysis step, so a backlog of
 * unlooked-at words never sits behind grammar/meaning glossing of sentences
 * the learner has already confirmed. Confirmations can still take *more*
 * than this share (the rest of the bucket is filled in reading order,
 * both step kinds) — it's a floor, not a cap; and if there's no vocab
 * backlog the reserve is zero and structural analysis uses the whole bucket.
 */
export const VOCAB_CONFIRM_MIN_GLOSSING_SHARE = 0.6;

/**
 * Ceiling on how far redistribution (minutes freed by a bucket that hit its
 * own candidate ceiling) can push any single bucket past its own
 * weight-based fair share of the requested time. Without this, a session
 * that's mostly one bucket by the learner's split (e.g. 90% review) but has
 * a thin candidate list for it dumps all the freed minutes into whichever
 * other bucket still has candidates — turning a 5%-share bucket into most of
 * the session. 2 = a bucket can absorb at most double its fair share from
 * redistribution; anything beyond that goes idle and the session is shorter.
 */
export const REDISTRIBUTION_MAX_SHARE_MULTIPLE = 2;

/** Rolling window (days) recent-activity distribution and neglect are computed over — prompt point 6's "7- or 14-day view." */
export const NEGLECT_WINDOW_DAYS = 14;

/** How strongly a fully-neglected bucket (untouched for the whole window) can pull the baseline allocation toward itself — a fraction added on top of its baseline share before renormalizing, so the baseline is nudged, not overridden. */
export const MAX_NEGLECT_BOOST = 0.6;

/** A subject with no re-encounter signal for this many days starts losing review priority (prompt point 4's "gradually reducing review priority for items mined once long ago and never re-encountered"). Never reaches zero — see STALE_PRIORITY_FLOOR. */
export const STALE_REENCOUNTER_DAYS = 30;

/** Floor on the stale-item priority decay factor — an old, never-re-encountered item still gets *some* priority, it's just deprioritized relative to actively-recurring material. Matches the "do not silently delete user data" requirement: nothing is ever fully zeroed out. */
export const STALE_PRIORITY_FLOOR = 0.25;

/** Default cap on how many due reviews a session actually includes, regardless of how large the due queue is (prompt point 4: "choose the best 10-15 reviews... not the entire due queue"). */
export const REVIEW_PRIORITY_DEFAULT_LIMIT = 15;

/** How many due StudyItems per pool are fetched (already due-date sorted) before scoring — bounds the cost of the per-candidate diversity/history lookups regardless of total due-queue size. */
export const SESSION_PLANNER_CANDIDATE_POOL_SIZE = 60;

/** How many books' "continue reading" glossing candidates to consider. */
export const EXPLORE_CANDIDATE_LIMIT = 5;

/** Cap on how many of a book's next unstarted sentences findExploreCandidates previews per book — generous relative to any realistic single day's glossing budget (MODE_ACTIVITY_ESTIMATE_MINUTES.glossing is 2.5 min/item, so 20 covers 50 min of glossing alone). */
export const EXPLORE_SENTENCE_PREVIEW_LIMIT = 20;

/** How many not-yet-tracked grammar patterns to consider as candidates. */
export const UNDERSTAND_CANDIDATE_LIMIT = 8;

/** How many shadowing candidates to consider. */
export const SHADOW_CANDIDATE_LIMIT = 10;

/** How many of a learner's most-recently-opened, non-archived books count as "in scope" for shadowing candidates. */
export const SHADOW_ACTIVE_BOOK_LIMIT = 5;
