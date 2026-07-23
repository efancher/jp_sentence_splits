import { getDb } from '../db/database';
import { ensureSyncMeta } from './queue';

/** Detect whether local IndexedDB has study data worth migrating. */
export async function hasLocalStudyData(): Promise<boolean> {
  const db = getDb();
  const [books, sentences] = await Promise.all([
    db.books.count(),
    db.sentences.count(),
  ]);
  return books > 0 || sentences > 0;
}

export async function needsMigrationPrompt(userId: string): Promise<boolean> {
  const meta = await ensureSyncMeta();
  if (meta.migrationChoice) return false;
  if (meta.userId && meta.userId !== userId && meta.migrationChoice) return false;
  const local = await hasLocalStudyData();
  return local;
}
