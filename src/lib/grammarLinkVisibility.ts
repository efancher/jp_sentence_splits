import type { SentenceGrammar } from '../domain/types';

type LinkFlags = Pick<SentenceGrammar, 'source' | 'confirmedByLearner'>;

/** An assistant-suggested link the learner has not acted on (the grammar extra writes these). */
export function isUnreviewedAiLink(link: LinkFlags): boolean {
  return link.source === 'ai_suggested' && !link.confirmedByLearner;
}

/**
 * Links the learner should see: everything except unreviewed assistant links on sentences not yet introduced
 * (walked through, started in a book, or carded). The learner's own and confirmed links are always visible.
 * A display rule only; it deletes nothing and gates no study step.
 */
export function visibleGrammarLinks<T extends LinkFlags & Pick<SentenceGrammar, 'sentenceId'>>(
  links: readonly T[],
  introducedSentenceIds: ReadonlySet<string>,
): T[] {
  return links.filter((link) => !isUnreviewedAiLink(link) || introducedSentenceIds.has(link.sentenceId));
}

/**
 * An assistant-created pattern stays out of the grammar list until it has a visible link or a card, so patterns
 * proposed for sentences the learner has not met yet do not clutter it.
 */
export function isPatternListed(
  pattern: { provenance: 'manual' | 'ai_suggested' },
  visibleLinkCount: number,
  hasStudyItem: boolean,
): boolean {
  return pattern.provenance !== 'ai_suggested' || visibleLinkCount > 0 || hasStudyItem;
}
