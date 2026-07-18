import Dexie, { type EntityTable, type Transaction } from 'dexie';

import { DB_NAME } from '../appConfig';
import type {
  AppSettings,
  Book,
  BookSentence,
  ImportBatch,
  InboxMembership,
  Sentence,
  SentenceAnalysis,
} from '../domain/types';

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'settings',
  theme: 'system',
  hideSatoriEnglishInitially: true,
  showReadingsInitially: false,
  defaultImportDestination: 'inbox',
  textDisplayMode: 'plain',
};

export class GlossbookDatabase extends Dexie {
  books!: EntityTable<Book, 'id'>;
  sentences!: EntityTable<Sentence, 'id'>;
  bookSentences!: EntityTable<BookSentence, 'id'>;
  analyses!: EntityTable<SentenceAnalysis, 'sentenceId'>;
  importBatches!: EntityTable<ImportBatch, 'id'>;
  inbox!: EntityTable<InboxMembership, 'sentenceId'>;
  settings!: EntityTable<AppSettings, 'id'>;

  constructor(name = DB_NAME) {
    super(name);

    this.version(1).stores({
      books: 'id, title, archived, updatedAt, lastOpenedAt',
      sentences: 'id, normalizedKey, updatedAt, earliestCreatedAt, latestCreatedAt',
      bookSentences: 'id, bookId, sentenceId, [bookId+sentenceId], position, status',
      analyses: 'sentenceId, status, updatedAt',
      importBatches: 'id, importedAt, batchName',
      inbox: 'sentenceId, importBatchId, addedAt',
      settings: 'id',
    });

    // Example future migration hook — keep versions explicit.
    this.version(2)
      .stores({
        books: 'id, title, archived, updatedAt, lastOpenedAt',
        sentences:
          'id, normalizedKey, updatedAt, earliestCreatedAt, latestCreatedAt',
        bookSentences:
          'id, bookId, sentenceId, [bookId+sentenceId], position, status',
        analyses: 'sentenceId, status, updatedAt',
        importBatches: 'id, importedAt, batchName',
        inbox: 'sentenceId, importBatchId, addedAt',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        await migrateSettingsV2(tx);
      });
  }
}

async function migrateSettingsV2(tx: Transaction): Promise<void> {
  const table = tx.table('settings');
  const current = await table.get('settings');
  if (!current) {
    await table.put(DEFAULT_SETTINGS);
    return;
  }
  await table.put({
    ...DEFAULT_SETTINGS,
    ...current,
    id: 'settings',
  });
}

let dbInstance: GlossbookDatabase | null = null;

export function getDb(): GlossbookDatabase {
  if (!dbInstance) {
    dbInstance = new GlossbookDatabase();
  }
  return dbInstance;
}

/** Test helper: replace the singleton with a fresh in-memory-named DB. */
export function resetDbForTests(name?: string): GlossbookDatabase {
  if (dbInstance) {
    dbInstance.close();
  }
  dbInstance = new GlossbookDatabase(name ?? `${DB_NAME}-test-${Date.now()}`);
  return dbInstance;
}

export async function readSettings(db = getDb()): Promise<AppSettings> {
  const existing = await db.settings.get('settings');
  return existing ?? DEFAULT_SETTINGS;
}

/** May write — do not call from a Dexie liveQuery callback. */
export async function ensureSettings(db = getDb()): Promise<AppSettings> {
  const existing = await db.settings.get('settings');
  if (existing) return existing;
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}
