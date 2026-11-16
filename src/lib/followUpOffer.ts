/**
 * Which reader tool to offer after a Read check ends in "needed help"
 * (docs/ROADMAP.md, "Follow-up offers and activity effectiveness"). Pure: the
 * caller says which tools can open on the sentence and supplies the random draw.
 *
 * The offer is a suggestion, never a queued task, and the tools it opens stay
 * evidence-only (no FSRS). Some offers are drawn at random so a later analysis
 * has a baseline: a follow-up chosen because the learner struggled would
 * otherwise look worse than it is. Each offer records its `source`.
 */

export type FollowUpTool = 'tiles' | 'dictate' | 'meaning' | 'shadow' | 'reading' | 'grammar';
export type LearningAspect = 'reading' | 'meaning' | 'listening' | 'pronunciation' | 'grammar';
/** `learner`: the learner named what was hard (`FollowUpCause`) and the offer matches it; no random draw. */
export type FollowUpSource = 'rule' | 'random' | 'learner';

/** The aspect each follow-up is meant to support, for grouping offers in the after-effect view. */
export const FOLLOW_UP_ASPECT: Record<FollowUpTool, LearningAspect> = {
  tiles: 'listening',
  dictate: 'listening',
  meaning: 'meaning',
  shadow: 'pronunciation',
  reading: 'reading',
  grammar: 'grammar',
};

export const FOLLOW_UP_LABEL: Record<FollowUpTool, string> = {
  tiles: 'Ear tiles',
  dictate: 'Dictation',
  meaning: 'Word check',
  shadow: 'Shadowing',
  reading: 'Reading check',
  grammar: 'Grammar check',
};

/** What the offer line says the tool is for. */
export const FOLLOW_UP_PURPOSE: Record<FollowUpTool, string> = {
  tiles: 'rebuild the sentence from what you hear',
  dictate: 'type one phrase from what you hear',
  meaning: 'recall a word in it',
  shadow: 'say it along with the clip',
  reading: 'type how a word in it is read',
  grammar: 'recall what a pattern in it does',
};

/** Share of offers drawn uniformly from the available tools instead of by the rule. */
export const FOLLOW_UP_RANDOM_RATE = 0.4;

/**
 * Rule order when nothing says otherwise: a weak word first, then the listening pair (Dictation before the easier
 * Ear tiles, 2026-11-08), then sound. The Reading and Grammar checks are offered only for a named cause, so the
 * rule and random rows stay comparable with the offers logged before they existed.
 */
const RULE_ORDER: readonly FollowUpTool[] = ['meaning', 'dictate', 'tiles', 'shadow'];

export interface FollowUpChoice {
  tool: FollowUpTool;
  source: FollowUpSource;
}

/**
 * `available` lists the tools that can open on this sentence. `weakWord` says the sentence has a content
 * word the learner is weak on, which moves Word check to the front of the rule. `draw` is a value in
 * [0, 1) deciding random vs rule; `pick` is another in [0, 1) choosing among the available tools when random.
 */
export function chooseFollowUp(input: {
  available: readonly FollowUpTool[];
  weakWord?: boolean;
  draw: number;
  pick: number;
}): FollowUpChoice | null {
  const available = RULE_ORDER.filter((tool) => input.available.includes(tool));
  if (available.length === 0) return null;
  if (input.draw < FOLLOW_UP_RANDOM_RATE) {
    const index = Math.min(available.length - 1, Math.floor(input.pick * available.length));
    return { tool: available[index]!, source: 'random' };
  }
  const ruled = input.weakWord ? available : available.filter((tool) => tool !== 'meaning');
  return { tool: (ruled[0] ?? available[0])!, source: 'rule' };
}

/** What the learner says made the sentence hard, picked after "needed help". */
export type FollowUpCause = 'reading' | 'meaning' | 'listening' | 'grammar';

export const FOLLOW_UP_CAUSE_LABEL: Record<FollowUpCause, string> = {
  reading: 'Reading a word',
  meaning: "A word's meaning",
  listening: 'Hearing it',
  grammar: 'How the grammar fits',
};

/** The tools that answer each cause, in order of preference. */
const CAUSE_TOOLS: Record<FollowUpCause, readonly FollowUpTool[]> = {
  reading: ['reading'],
  meaning: ['meaning'],
  listening: ['dictate', 'tiles'],
  grammar: ['grammar'],
};

/**
 * The follow-up for a cause the learner named: the first available tool that answers it, with source `learner`.
 * Null when none can open (the caller then falls back to `chooseFollowUp`). No random draw: the learner said what
 * was wrong, and a baseline offer of something else would ignore them.
 */
export function chooseFollowUpForCause(input: { available: readonly FollowUpTool[]; cause: FollowUpCause }): FollowUpChoice | null {
  const tool = CAUSE_TOOLS[input.cause].find((candidate) => input.available.includes(candidate));
  return tool ? { tool, source: 'learner' } : null;
}
