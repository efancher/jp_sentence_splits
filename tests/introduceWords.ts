import { ensureStudyItem, getDb } from '../src/db/repository';

/** Marks each word as reviewed once (past FSRS `new`), so sentences containing it count as "seen". */
export async function introduceWords(vocabularyItemIds: string[]): Promise<void> {
  for (const id of vocabularyItemIds) {
    const item = await ensureStudyItem('vocabularyItem', id, 'reading_retrieval');
    await getDb().studyItems.update(item.id, { fsrsState: { ...item.fsrsState, state: 'review', lastReview: new Date().toISOString() } });
  }
}
