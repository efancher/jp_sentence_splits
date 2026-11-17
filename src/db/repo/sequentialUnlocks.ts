// ---------------------------------------------------------------------------
// Sequential study mode: per-book episode progress and its persisted unlock
// latches (src/lib/sequentialStudy.ts holds the pure status logic). Moved
// below the FSRS section because `recordReview` latches unlocks after a
// reading_in_context review (REPOSITORY_SPLIT_HANDOFF: shared helpers move
// down, never up).
// ---------------------------------------------------------------------------

import type { BookSentence, Review, SentenceAnalysis } from '../../domain/types';
import { getMeaningBank } from '../../lib/meaningChoices';
import { computeSequentialStatus, type SequentialBookStatus } from '../../lib/sequentialStudy';
import { isSequentialStudyMode } from '../../lib/sentenceLed';
import { getDb, readSettings } from '../database';
import { updateSettings } from './settingsWrites';
import {
  plannerPassActive,
  plannerShared,
  readAllStudyItemsForPass,
  readUsableCheckSentenceIdsForPass,
  reviewsForStudyItems,
  rowCount,
  traceStep,
} from './passReads';
import { listSentenceLearningEvents } from './sentenceLearningEvents';

/**
 * Per-sentence access for one book under sequential study mode, in episode
 * order. Read-only (safe inside a live query); `latchSequentialUnlocks`
 * persists the result so unlocks never revert.
 */
export async function getSequentialBookStatus(
  bookId: string,
  knownMemberships?: BookSentence[],
): Promise<SequentialBookStatus> {
  const db = getDb();
  const memberships = knownMemberships ?? (await db.bookSentences.where('bookId').equals(bookId).toArray());
  const sentenceIds = memberships.map((item) => item.sentenceId);
  const [settings, analyses, events, studyItems] = await Promise.all([
    readSettings(),
    plannerPassActive()
      ? Promise.resolve([] as Array<SentenceAnalysis | undefined>)
      : traceStep('sequential: analyses.bulkGet', () => db.analyses.bulkGet(sentenceIds), rowCount),
    traceStep('sequential: book events', () => listSentenceLearningEvents(bookId), rowCount),
    traceStep('sequential: reading_in_context items', () =>
      plannerShared('readingInContextItems', ['studyItems'], async () =>
        (await readAllStudyItemsForPass()).filter(
          (item) => item.activityType === 'reading_in_context' && item.subjectType === 'sentence',
        ),
      ),
      rowCount,
    ),
  ]);
  const itemBySentence = new Map(studyItems.map((item) => [item.subjectId, item]));
  const reviewItemIds = sentenceIds.flatMap((id) => (itemBySentence.get(id) ? [itemBySentence.get(id)!.id] : []));
  const reviews = reviewItemIds.length
    ? await traceStep('sequential: reviews', () => reviewsForStudyItems(reviewItemIds), rowCount)
    : [];
  const reviewsByItem = new Map<string, Review[]>();
  for (const review of reviews) {
    const list = reviewsByItem.get(review.studyItemId);
    if (list) list.push(review);
    else reviewsByItem.set(review.studyItemId, [review]);
  }
  const walked = new Set(
    events.filter((event) => event.action === 'walkthrough_completed').map((event) => event.sentenceId),
  );
  // Planner passes ask this for every book; the stored list of usable checks replaces reading each analysis.
  const usableChecks = plannerPassActive()
    ? await traceStep('sequential: usable checks', () => readUsableCheckSentenceIdsForPass(), (ids) => ids.size)
    : null;
  return computeSequentialStatus(
    memberships.map((membership, index) => {
      const item = itemBySentence.get(membership.sentenceId);
      const bank = usableChecks ? null : getMeaningBank(analyses[index]?.comprehensionCheck);
      return {
        sentenceId: membership.sentenceId,
        position: membership.position,
        hasUsableCheck: usableChecks ? usableChecks.has(membership.sentenceId) : (bank?.distractors.length ?? 0) > 0,
        reviews: item ? (reviewsByItem.get(item.id) ?? []) : [],
        // Sentences already worked on before the mode was enabled stay open.
        introduced: membership.status !== 'unstarted' || walked.has(membership.sentenceId),
        // Each chapter is its own episode; chapterless sentences share one.
        ...(membership.chapterId ? { groupId: membership.chapterId } : {}),
      };
    }),
    new Set(settings.sequentialUnlockOverrides ?? []),
  );
}

/** Persist newly reached unlocks (settings.sequentialUnlockOverrides) so they can never revert. */
export async function latchSequentialUnlocks(bookId: string): Promise<string[]> {
  const settings = await readSettings();
  if (!isSequentialStudyMode(settings)) return [];
  const { newlyLatched } = await getSequentialBookStatus(bookId);
  if (newlyLatched.length === 0) return [];
  await updateSettings({
    sequentialUnlockOverrides: [...new Set([...(settings.sequentialUnlockOverrides ?? []), ...newlyLatched])],
  });
  return newlyLatched;
}

export async function latchSequentialUnlocksForSentence(sentenceId: string): Promise<void> {
  if (!isSequentialStudyMode(await readSettings())) return;
  const memberships = await getDb().bookSentences.where('sentenceId').equals(sentenceId).toArray();
  for (const bookId of new Set(memberships.map((membership) => membership.bookId))) {
    await latchSequentialUnlocks(bookId);
  }
}
