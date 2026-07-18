import { describe, expect, it } from 'vitest';

import { GlossbookDatabase, readSettings } from '../src/db/database';
import { createId } from '../src/lib/ids';

describe('Dexie schema migrations', () => {
  it('opens at the current schema version and seeds settings', async () => {
    const name = `migrate-${createId('db')}`;
    const db = new GlossbookDatabase(name);
    await db.open();
    expect(db.verno).toBeGreaterThanOrEqual(2);
    const settings = await readSettings(db);
    expect(settings.id).toBe('settings');
    expect(settings.theme).toBe('system');
    db.close();
    await indexedDB.deleteDatabase(name);
  });
});
