import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PG_TESTS_ENABLED, pgClientFor, resetDatabase, scalar, sql, USER_A, USER_B, type PgClient } from './harness';

const current = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../../src/sync/supabaseClient', () => ({
  getSupabase: () => current.client,
  isSupabaseConfigured: () => true,
}));

import { getDb, resetDbForTests } from '../../src/db/database';
import {
  ensureGrammarPattern,
  ensureKanji,
  ensureSentenceGrammar,
  ensureVocabularyItem,
} from '../../src/db/repository';
import { createId } from '../../src/lib/ids';
import { pushMutations } from '../../src/sync/engine';
import { updateSyncMeta } from '../../src/sync/queue';

/** Simulates one device: a fresh local database signed in as `userId`. */
async function device(userId: string): Promise<PgClient> {
  resetDbForTests(`pg-${createId('db')}`);
  await updateSyncMeta({ userId });
  const pg = pgClientFor(userId);
  current.client = pg.client;
  return pg;
}

/** `notifySync` enqueues fire-and-forget; wait until the queue stops growing. */
async function settleQueue(): Promise<void> {
  let last = -1;
  let stable = 0;
  while (stable < 3) {
    await new Promise((r) => setTimeout(r, 25));
    const n = await getDb().syncQueue.count();
    stable = n === last ? stable + 1 : 0;
    last = n;
  }
}

async function pushOnce(): Promise<string | undefined> {
  await settleQueue();
  return pushMutations();
}

async function drain(maxCycles = 5): Promise<(string | undefined)[]> {
  const results: (string | undefined)[] = [];
  for (let i = 0; i < maxCycles; i += 1) {
    results.push(await pushOnce());
    if ((await getDb().syncQueue.count()) === 0) break;
  }
  return results;
}

describe.skipIf(!PG_TESTS_ENABLED)('push against real Postgres + RLS', () => {
  beforeEach(() => {
    resetDatabase();
  });

  it('pushes a whole new word (item + kanji + links) in one cycle, parents before links', async () => {
    await device(USER_A);
    await ensureVocabularyItem('宮本', 'みやもと', { meaning: 'Miyamoto' });

    expect(await pushOnce()).toBeUndefined();

    expect(await getDb().syncQueue.count()).toBe(0);
    expect(scalar('select count(*) from vocabulary_items')).toBe('1');
    expect(scalar('select count(*) from kanji')).toBe('2');
    expect(scalar('select count(*) from vocabulary_kanji')).toBe('2');
  });

  it('pushes a large burst with far fewer requests than rows', async () => {
    const pg = await device(USER_A);
    const words = Array.from({ length: 60 }, (_, i) => `語${String.fromCodePoint(0x4e00 + i)}`);
    for (const word of words) await ensureVocabularyItem(word, 'ごご');

    expect(await pushOnce()).toBeUndefined();

    expect(scalar('select count(*) from vocabulary_items')).toBe('60');
    const rows = 60 + 61 + 120; // items + distinct kanji (語 + 60) + links
    expect(pg.requestCount()).toBeLessThan(rows / 4);
  });

  it('two devices creating the same word converge on one row with one id', async () => {
    await device(USER_A);
    const a = await ensureVocabularyItem('猫', 'ねこ');
    await drain();

    await device(USER_A); // the laptop, which has never seen the phone's row
    const b = await ensureVocabularyItem('猫', 'ねこ');
    expect(b.id).toBe(a.id);
    expect(await drain()).toEqual([undefined]);

    expect(scalar('select count(*) from vocabulary_items')).toBe('1');
    expect(scalar('select count(*) from kanji')).toBe('1');
    expect(scalar('select count(*) from vocabulary_kanji')).toBe('1');
    expect(await getDb().syncQueue.count()).toBe(0);
  });

  it('a second device creating the same grammar pattern + link does not clobber the first copy', async () => {
    await device(USER_A);
    sql(`insert into sentences (id, owner_id, japanese, normalized_key, created_at, updated_at, version) values ('sent_1','${USER_A}','今、犬。','k1',now(),now(),1)`);
    const p = await ensureGrammarPattern('～ている', { shortMeaning: 'phone version' });
    await ensureSentenceGrammar('sent_1', p.id, {});
    await drain();
    sql(`update grammar_patterns set explanation = 'edited on phone' where id = '${p.id}'`);

    await device(USER_A);
    const p2 = await ensureGrammarPattern('～ている', { shortMeaning: 'laptop version' });
    await ensureSentenceGrammar('sent_1', p2.id, {});
    expect(p2.id).toBe(p.id);
    await drain();

    expect(scalar('select count(*) from grammar_patterns')).toBe('1');
    expect(scalar('select count(*) from sentence_grammar')).toBe('1');
    expect(scalar(`select explanation from grammar_patterns where id = '${p.id}'`)).toBe('edited on phone');
    expect((await getDb().grammarPatterns.get(p.id))?.shortMeaning).toBe('phone version');
  });

  it('ids are scoped per user, so two users learning the same kanji do not collide', async () => {
    await device(USER_A);
    const a = await ensureKanji('宮');
    await drain();

    await device(USER_B);
    const b = await ensureKanji('宮');
    expect(b.id).not.toBe(a.id);
    expect(await drain()).toEqual([undefined]);

    expect(scalar('select count(*) from kanji')).toBe('2');
  });

  it('a word deleted on the server (tombstone) can be re-created and pushed again', async () => {
    await device(USER_A);
    const first = await ensureVocabularyItem('犬', 'いぬ');
    await drain();
    sql(`update vocabulary_items set deleted_at = now() where id = '${first.id}'`);

    await device(USER_A);
    const again = await ensureVocabularyItem('犬', 'いぬ');
    expect(again.id).toBe(first.id);
    expect(await drain()).toEqual([undefined]);

    expect(scalar(`select count(*) from vocabulary_items where id = '${first.id}' and deleted_at is null`)).toBe('1');
  });

  it('a link to a pattern that exists nowhere is dropped without blocking the rest of the queue', async () => {
    await device(USER_A);
    sql(`insert into sentences (id, owner_id, japanese, normalized_key, created_at, updated_at, version) values ('sent_1','${USER_A}','今、犬。','k1',now(),now(),1)`);
    const p = await ensureGrammarPattern('～ている', {});
    await ensureSentenceGrammar('sent_1', p.id, {});
    await ensureKanji('犬');
    // the pattern vanishes locally before it was ever pushed (the 2026-09-19 orphan)
    await getDb().grammarPatterns.delete(p.id);
    await getDb().syncQueue.where('entity').equals('grammar_patterns').delete();

    await drain();

    expect(await getDb().syncQueue.count()).toBe(0);
    expect(scalar('select count(*) from kanji')).toBe('1');
    expect(scalar('select count(*) from sentence_grammar')).toBe('0');
  });
});
