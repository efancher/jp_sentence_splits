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

export type FollowUpTool = 'tiles' | 'dictate' | 'meaning' | 'shadow';
export type LearningAspect = 'reading' | 'meaning' | 'listening' | 'pronunciation' | 'grammar';
export type FollowUpSource = 'rule' | 'random';

/** The aspect each follow-up is meant to support, for grouping offers in the after-effect view. */
export const FOLLOW_UP_ASPECT: Record<FollowUpTool, LearningAspect> = {
  tiles: 'listening',
  dictate: 'listening',
  meaning: 'meaning',
  shadow: 'pronunciation',
};

export const FOLLOW_UP_LABEL: Record<FollowUpTool, string> = {
  tiles: 'Ear tiles',
  dictate: 'Dictation',
  meaning: 'Word check',
  shadow: 'Shadowing',
};

/** What the offer line says the tool is for. */
export const FOLLOW_UP_PURPOSE: Record<FollowUpTool, string> = {
  tiles: 'rebuild the sentence from what you hear',
  dictate: 'type one phrase from what you hear',
  meaning: 'recall a word in it',
  shadow: 'say it along with the clip',
};

/** Share of offers drawn uniformly from the available tools instead of by the rule. */
export const FOLLOW_UP_RANDOM_RATE = 0.4;

/** Rule order when nothing says otherwise: a weak word first, then the listening pair, then sound. */
const RULE_ORDER: readonly FollowUpTool[] = ['meaning', 'tiles', 'dictate', 'shadow'];

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
