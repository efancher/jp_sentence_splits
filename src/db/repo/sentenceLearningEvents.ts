// ---------------------------------------------------------------------------
// Learning-event log reads shared by the sequential-unlock layer, the
// planner and the Reader (bottom layer so `recordReview`'s latch chain can
// reach them without importing upward).
// ---------------------------------------------------------------------------

import type { SentenceLearningEvent } from '../../domain/types';
import { withoutResetWalkthroughs } from '../../lib/sentenceLearning';
import { getDb } from '../database';
import { plannerPassActive, readAllLearningEventsForPass } from './passReads';

export async function listSentenceLearningEvents(bookId: string): Promise<SentenceLearningEvent[]> {
  if (plannerPassActive()) {
    // Inside a planning pass this runs once per book; filter the single shared scan instead.
    return (await readAllLearningEventsForPass())
      .filter((event) => event.bookId === bookId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  return withoutResetWalkthroughs(await getDb().sentenceLearningEvents.where('bookId').equals(bookId).sortBy('timestamp'));
}
