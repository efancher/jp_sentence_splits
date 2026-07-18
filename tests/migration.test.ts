import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';

import { GlossbookDatabase, readSettings } from '../src/db/database';
import { createId } from '../src/lib/ids';

describe('Dexie schema migrations', () => {
  it('opens at the current schema version and seeds settings', async () => {
    const name = `migrate-${createId('db')}`;
    const db = new GlossbookDatabase(name);
    await db.open();
    expect(db.verno).toBeGreaterThanOrEqual(3);
    const settings = await readSettings(db);
    expect(settings.id).toBe('settings');
    expect(settings.theme).toBe('system');
    db.close();
    await indexedDB.deleteDatabase(name);
  });

  it('adds empty chapter collections to books from schema v2', async () => {
    const name = `migrate-v2-${createId('db')}`;
    const legacy = new Dexie(name);
    legacy.version(2).stores({
      books: 'id, title, archived, updatedAt, lastOpenedAt',
    });
    await legacy.open();
    await legacy.table('books').put({
      id: 'legacy-book',
      title: 'Legacy',
      archived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    legacy.close();

    const migrated = new GlossbookDatabase(name);
    await migrated.open();
    expect((await migrated.books.get('legacy-book'))?.chapters).toEqual([]);
    migrated.close();
    await indexedDB.deleteDatabase(name);
  });
});
