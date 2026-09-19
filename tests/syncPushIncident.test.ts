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
