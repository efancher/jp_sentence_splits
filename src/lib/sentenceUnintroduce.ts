/**
 * Planning for un-introducing sentences (scripts/unintroduce-sentences.ts): a sentence counts as introduced
 * through a `walkthrough_completed` event, a started book membership, or any sentence study item
 * (`getIntroducedSentenceIds`). Putting one back in the i+1 pool means cancelling the walkthrough with a
 * `walkthrough_reset` event and retiring every sentence card. Reviews and other events stay as history.
 */
import type { SentenceLearningAction } from '../domain/types';
import { withoutResetWalkthroughs } from './sentenceLearning';

export interface UnintroduceStudyItem {
  id: string;
  subjectId: string;
  activityType: string;
}

export interface UnintroduceEvent {
  timestamp: string;
  sentenceId: string;
  action: SentenceLearningAction;
}

export interface UnintroduceMembership {
  sentenceId: string;
  bookId: string;
  chapterId?: string;
  status: string;
}

export interface UnintroducePlan {
  /** Sentences that are introduced now and will be reset. */
  sentenceIds: string[];
  /** Sentences that need a `walkthrough_reset` event (one per sentence, with the book to log it against). */
  resetEvents: { sentenceId: string; bookId: string; chapterId?: string }[];
  retireItemIds: string[];
  /** Introduced through a started book membership; a script cannot undo that, so they are skipped. */
  skippedStartedMembership: string[];
}

export function planUnintroduce(
  sentenceIds: readonly string[],
  events: readonly UnintroduceEvent[],
  items: readonly UnintroduceStudyItem[],
  memberships: readonly UnintroduceMembership[],
): UnintroducePlan {
  const wanted = new Set(sentenceIds);
  const walked = new Set(
    withoutResetWalkthroughs(events)
      .filter((e) => e.action === 'walkthrough_completed' && wanted.has(e.sentenceId))
      .map((e) => e.sentenceId),
  );
  const startedMembership = new Set(
    memberships.filter((m) => m.status !== 'unstarted' && wanted.has(m.sentenceId)).map((m) => m.sentenceId),
  );
  const itemsBySentence = new Map<string, UnintroduceStudyItem[]>();
  for (const item of items) {
    if (!wanted.has(item.subjectId)) continue;
    const list = itemsBySentence.get(item.subjectId);
    if (list) list.push(item);
    else itemsBySentence.set(item.subjectId, [item]);
  }
  const reset = [...wanted]
    .filter((id) => (walked.has(id) || itemsBySentence.has(id)) && !startedMembership.has(id))
    .sort();
  const resetEvents = reset
    .filter((id) => walked.has(id))
    .flatMap((sentenceId) => {
      const membership = memberships.find((m) => m.sentenceId === sentenceId);
      return membership ? [{ sentenceId, bookId: membership.bookId, chapterId: membership.chapterId }] : [];
    });
  return {
    sentenceIds: reset,
    resetEvents,
    retireItemIds: reset.flatMap((id) => (itemsBySentence.get(id) ?? []).map((item) => item.id)),
    skippedStartedMembership: [...startedMembership].sort(),
  };
}
