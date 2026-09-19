import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, resetDbForTests } from '../src/db/database';
import {
  ensureGrammarPattern,
  ensureSentenceGrammar,
  ensureStudyItem,
} from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { enqueueMutation } from '../src/sync/queue';

/**
 * Reproduction of the 2026-09-19 incident: a laptop created grammar patterns
 * (and links / study items for them) that another device had already created —
 * same natural keys, different ids. The fake server below enforces the same
 * rules production does: the unique indexes (23505) and the sentence_grammar
 * insert policy (the referenced pattern must exist and be live: RLS 42501).
 */

type Row = Record<string, any>;

const server = vi.hoisted(() => {
  const tables: Record<string, Row[]> = {};
  const log: string[] = [];
  function rows(table: string): Row[] {
    return (tables[table] ??= []);
  }
  const live = (r: Row) => r.deleted_at == null;
  function insertRow(table: string, row: Row): { error: { code: string; message: string } | null } {
    if (rows(table).some((r) => r.id === row.id)) {
      log.push(`${table} insert ${row.id}: 23505 pk`);
      return { error: { code: '23505', message: `duplicate key value violates unique constraint "${table}_pkey"` } };
    }
    if (table === 'sentence_grammar') {
      const patternOk = rows('grammar_patterns').some((p) => p.id === row.grammar_pattern_id && live(p));
      const sentenceOk = rows('sentences').some((s) => s.id === row.sentence_id);
      if (!patternOk || !sentenceOk) {
        log.push(`sentence_grammar insert ${row.id}: RLS (pattern ${row.grammar_pattern_id} ${patternOk ? 'ok' : 'MISSING'}, sentence ${sentenceOk ? 'ok' : 'MISSING'})`);
        return { error: { code: '42501', message: 'new row violates row-level security policy for table "sentence_grammar"' } };
      }
    }
    const clash = (cols: string[]) => rows(table).some((r) => live(r) && live(row) && cols.every((c) => r[c] === row[c]));
    if (
      (table === 'grammar_patterns' && clash(['normalized_key'])) ||
      (table === 'sentence_grammar' && clash(['sentence_id', 'grammar_pattern_id'])) ||
      (table === 'study_items' && clash(['subject_type', 'subject_id', 'activity_type'])) ||
      (table === 'grammar_relationships' && clash(['pattern_a_id', 'pattern_b_id', 'relationship_type']))
    ) {
      log.push(`${table} insert ${row.id}: 23505 natural key`);
      return { error: { code: '23505', message: `duplicate key value violates unique constraint "${table}_uidx"` } };
    }
    rows(table).push({ ...row });
    log.push(`${table} insert ${row.id}: ok`);
    return { error: null };
  }
  function from(table: string) {
    const filters: [string, unknown][] = [];
    const nulls: string[] = [];
    let patch: Row | null = null;
    const matching = () => rows(table).filter((r) => filters.every(([c, v]) => r[c] === v) && nulls.every((c) => r[c] == null));
    const q: any = {
      select: () => {
        if (patch) {
          const hit = matching();
          hit.forEach((r) => Object.assign(r, patch));
          return Promise.resolve({ data: hit.map((r) => ({ version: r.version })), error: null });
        }
        return q;
      },
      is: (c: string) => (nulls.push(c), q),
      eq: (c: string, v: unknown) => (filters.push([c, v]), q),
      maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
      insert: async (row: Row) => insertRow(table, row),
      update: (p: Row) => ((patch = p), q),
    };
    return q;
  }
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }) },
    from,
  };
  return { tables, log, rows, client };
});

vi.mock('../src/sync/supabaseClient', () => ({ getSupabase: () => server.client }));

import { pushMutations } from '../src/sync/engine';

const iso = '2026-09-18T20:42:00.000Z';
const remotePattern = (id: string, name: string, key: string): Row => ({
  id, owner_id: 'user-1', canonical_name: name, normalized_key: key, aliases: [], short_meaning: '',
  provenance: 'manual', created_at: iso, updated_at: iso, deleted_at: null, version: 1,
});
const remoteLink = (id: string, sentenceId: string, patternId: string): Row => ({
  id, owner_id: 'user-1', sentence_id: sentenceId, grammar_pattern_id: patternId, confirmed_by_learner: true,
  source: 'manual', created_at: iso, updated_at: iso, deleted_at: null, version: 1,
});

async function queueAll(order: 'patternsFirst' | 'linksFirst') {
  const p1 = await ensureGrammarPattern('今、～', {});
  const p2 = await ensureGrammarPattern('～ています（現在進行）', {});
  const links = [
    await ensureSentenceGrammar('sent_a', p1.id, {}),
    await ensureSentenceGrammar('sent_a', p2.id, {}),
    await ensureSentenceGrammar('sent_b', p1.id, {}),
    await ensureSentenceGrammar('sent_b', p2.id, {}),
  ];
  const studies = [
    await ensureStudyItem('grammarPattern', p1.id, 'grammar_completion'),
    await ensureStudyItem('grammarPattern', p2.id, 'grammar_completion'),
  ];
  const items: [string, string, unknown][] = [
    ...(order === 'patternsFirst'
      ? [['grammar_patterns', p1.id, p1], ['grammar_patterns', p2.id, p2]] as [string, string, unknown][]
      : []),
    ...links.map((l) => ['sentence_grammar', l.id, l] as [string, string, unknown]),
    ...studies.map((s) => ['study_items', s.id, s] as [string, string, unknown]),
    ...(order === 'linksFirst'
      ? [['grammar_patterns', p1.id, p1], ['grammar_patterns', p2.id, p2]] as [string, string, unknown][]
      : []),
  ];
  for (const [entity, recordId, payload] of items) {
    await enqueueMutation({ entity: entity as never, recordId, operation: 'upsert', expectedVersion: null, payload });
    await new Promise((r) => setTimeout(r, 2)); // distinct localTimestamp => stable queue order
  }
  return { p1, p2, links, studies };
}

describe('incident: laptop created grammar patterns the phone already had', () => {
  beforeEach(() => {
    resetDbForTests(`sync-incident-${createId('db')}`);
    for (const k of Object.keys(server.tables)) delete server.tables[k];
    server.log.length = 0;
    server.rows('sentences').push({ id: 'sent_a', owner_id: 'user-1' }, { id: 'sent_b', owner_id: 'user-1' });
    server.rows('grammar_patterns').push(
      remotePattern('R1', '今、～', '今、'),
      remotePattern('R2', '～ています（現在進行）', 'ています（現在進行）'),
    );
    server.rows('sentence_grammar').push(
      remoteLink('RL1', 'sent_a', 'R1'),
      remoteLink('RL2', 'sent_a', 'R2'),
      remoteLink('RL3', 'sent_b', 'R1'),
      remoteLink('RL4', 'sent_b', 'R2'),
    );
  });

  /** The laptop already pulled the other device's rows, so both copies live in Dexie. */
  async function pullRemoteRowsLocally() {
    const db = getDb();
    const { remoteToGrammarPattern, remoteToSentenceGrammar } = await import('../src/sync/mappers');
    for (const row of server.rows('grammar_patterns')) await db.grammarPatterns.put(remoteToGrammarPattern(row));
    for (const row of server.rows('sentence_grammar')) await db.sentenceGrammar.put(remoteToSentenceGrammar(row));
  }

  for (const [order, pulled] of [
    ['patternsFirst', false],
    ['linksFirst', false],
    ['patternsFirst', true],
    ['linksFirst', true],
  ] as const) {
    it(`drains the queue within a few cycles (${order}${pulled ? ', remote rows already pulled' : ''})`, async () => {
      if (pulled) await pullRemoteRowsLocally();
      await queueAll(order);
      const failures: (string | undefined)[] = [];
      for (let cycle = 0; cycle < 5; cycle += 1) {
        failures.push(await pushMutations());
        if ((await getDb().syncQueue.count()) === 0) break;
      }
      const remaining = await getDb().syncQueue.toArray();
      // eslint-disable-next-line no-console
      if (remaining.length) console.log(order, 'REMAINING', remaining.map((q) => `${q.entity}:${q.recordId} ${q.lastError}`), '\nSERVER LOG\n' + server.log.join('\n'));
      expect(remaining.map((q) => `${q.entity}:${q.lastError}`)).toEqual([]);
      // every local link/study item now points at a pattern that exists remotely
      const remotePatternIds = new Set(server.rows('grammar_patterns').map((p) => p.id));
      for (const link of await getDb().sentenceGrammar.toArray()) expect(remotePatternIds.has(link.grammarPatternId), `link ${link.id}`).toBe(true);
      for (const item of (await getDb().studyItems.toArray()).filter((s) => s.subjectType === 'grammarPattern')) {
        expect(remotePatternIds.has(item.subjectId), `study ${item.id}`).toBe(true);
      }
      // no duplicate patterns were created on the server
      expect(server.rows('grammar_patterns')).toHaveLength(2);
    });
  }
});

/**
 * The second report from the laptop (with the queue now visible): four queue rows
 * for two `sentence_grammar` links — each queued twice — referencing patterns that
 * exist neither on the server nor in the local database any more, failing the
 * insert policy 70 times over.
 */
describe('incident: orphaned, twice-queued grammar links', () => {
  beforeEach(() => {
    resetDbForTests(`sync-orphan-${createId('db')}`);
    for (const k of Object.keys(server.tables)) delete server.tables[k];
    server.log.length = 0;
    server.rows('sentences').push({ id: 'sent_0b', owner_id: 'user-1' });
    server.rows('grammar_patterns').push(remotePattern('R_sorede', 'それで', 'それで'), remotePattern('R_mashita', '～ましたね', 'ましたね'));
    server.rows('sentence_grammar').push(remoteLink('RL_a', 'sent_0b', 'R_sorede'), remoteLink('RL_b', 'sent_0b', 'R_mashita'));
  });

  async function queueTwice(entity: 'sentence_grammar', recordId: string, payload: unknown, baseTs: number) {
    const db = getDb();
    for (const [i, id] of [`opq_${recordId}_1`, `opq_${recordId}_2`].entries()) {
      await db.syncQueue.put({
        id, entity, recordId, operation: 'upsert', expectedVersion: null, payload,
        localTimestamp: new Date(baseTs + i).toISOString(), retryCount: 70 - i, lastError: 'new row violates row-level security policy',
      });
    }
  }

  it('drops links whose pattern is gone locally (both queue rows), touching nothing on the server', async () => {
    const db = getDb();
    const l1 = await ensureSentenceGrammar('sent_0b', 'grammar_pattern_0d35-gone', {});
    const l2 = await ensureSentenceGrammar('sent_0b', 'grammar_pattern_b503-gone', {});
    expect(await db.grammarPatterns.count()).toBe(0);
    await queueTwice('sentence_grammar', l1.id, l1, 1_000);
    await queueTwice('sentence_grammar', l2.id, l2, 2_000);
    expect(await db.syncQueue.count()).toBe(4);
    const serverBefore = JSON.stringify(server.tables);

    const failure = await pushMutations();

    expect(failure).toBeUndefined();
    expect(await db.syncQueue.count()).toBe(0);
    expect(await db.sentenceGrammar.get(l1.id)).toBeUndefined();
    expect(await db.sentenceGrammar.get(l2.id)).toBeUndefined();
    expect(JSON.stringify(server.tables)).toBe(serverBefore);
    expect(await db.syncRecordMeta.get(`sentence_grammar:${l1.id}`)).toBeUndefined();
  });

  it('does NOT drop a link whose pattern exists locally but has not been pushed yet — it syncs once the pattern does', async () => {
    const db = getDb();
    const fresh = await ensureGrammarPattern('全く新しい文型', {});
    const link = await ensureSentenceGrammar('sent_0b', fresh.id, {});
    // link queued BEFORE its pattern: the first attempt hits RLS (pattern not on the server yet)
    await enqueueMutation({ entity: 'sentence_grammar', recordId: link.id, operation: 'upsert', expectedVersion: null, payload: link });
    await new Promise((r) => setTimeout(r, 3));
    await enqueueMutation({ entity: 'grammar_patterns', recordId: fresh.id, operation: 'upsert', expectedVersion: null, payload: fresh });

    await pushMutations();
    expect(await db.sentenceGrammar.get(link.id)).toBeDefined(); // not pruned
    await pushMutations();

    expect(await db.syncQueue.count()).toBe(0);
    expect(server.rows('sentence_grammar').some((r) => r.id === link.id)).toBe(true);
    expect(server.rows('grammar_patterns').some((r) => r.id === fresh.id)).toBe(true);
  });

  it('re-queues a pattern that exists locally, is missing on the server, and has no queue row of its own', async () => {
    const db = getDb();
    const lost = await ensureGrammarPattern('キューから消えた文型', {});
    const link = await ensureSentenceGrammar('sent_0b', lost.id, {});
    // only the link is queued; the pattern's own queue row was lost
    await enqueueMutation({ entity: 'sentence_grammar', recordId: link.id, operation: 'upsert', expectedVersion: null, payload: link });
    expect(await db.syncQueue.where('[entity+recordId]').equals(['grammar_patterns', lost.id]).count()).toBe(0);

    for (let cycle = 0; cycle < 4 && (await db.syncQueue.count()) > 0; cycle += 1) await pushMutations();

    expect(await db.syncQueue.count()).toBe(0);
    expect(server.rows('grammar_patterns').some((r) => r.id === lost.id)).toBe(true);
    expect(server.rows('sentence_grammar').some((r) => r.id === link.id)).toBe(true);
    expect(await db.sentenceGrammar.get(link.id)).toBeDefined();
  });

  it('collapses a queue that already holds twins before pushing, so a healthy record is pushed once', async () => {
    const db = getDb();
    const pattern = await ensureGrammarPattern('二重に積まれた', {});
    await queueTwice('sentence_grammar', 'sg_healthy_dup', { id: 'sg_healthy_dup', sentenceId: 'sent_0b', grammarPatternId: pattern.id }, 5_000);
    await enqueueMutation({ entity: 'grammar_patterns', recordId: pattern.id, operation: 'upsert', expectedVersion: null, payload: pattern });
    await pushMutations();
    await pushMutations();
    expect(await db.syncQueue.count()).toBe(0);
    const inserts = server.log.filter((l) => l.startsWith('sentence_grammar insert sg_healthy_dup'));
    expect(inserts.filter((l) => l.endsWith(': ok'))).toHaveLength(1);
  });
});
