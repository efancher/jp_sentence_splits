import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, resetDbForTests } from '../src/db/database';
import {
  ensureGrammarPattern,
  ensureGrammarRelationship,
  ensureSentenceGrammar,
  ensureStudyItem,
} from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { enqueueMutation } from '../src/sync/queue';

/**
 * Reported 2026-09-19: a laptop that hadn't synced since the previous day
 * created grammar patterns another device had already created (same
 * normalized_key, different id). Every push then failed with 23505 on
 * grammar_patterns_owner_normalized_key_uidx and the whole queue stayed stuck
 * ("10 pending", status "conflict"). kanji/vocabulary_items already adopted the
 * remote row in this situation; grammar_patterns and its link tables did not.
 */

const fake = vi.hoisted(() => {
  const calls: { table: string; eqs: [string, unknown][]; is: [string, unknown][] }[] = [];
  const state: { result: { data: unknown; error: unknown } } = { result: { data: null, error: null } };
  const client = {
    from(table: string) {
      const rec = { table, eqs: [] as [string, unknown][], is: [] as [string, unknown][] };
      calls.push(rec);
      const builder = {
        select: () => builder,
        is: (column: string, value: unknown) => {
          rec.is.push([column, value]);
          return builder;
        },
        eq: (column: string, value: unknown) => {
          rec.eqs.push([column, value]);
          return builder;
        },
        maybeSingle: async () => state.result,
      };
      return builder;
    },
  };
  return { calls, state, client };
});

vi.mock('../src/sync/supabaseClient', () => ({ getSupabase: () => fake.client }));

import { adoptRemoteDuplicate, remapDuplicateEntityId } from '../src/sync/engine';

const REMOTE_PATTERN_ID = 'grammar_pattern_00000000-remote'; // sorts before any real uuid-suffixed local id

function remotePatternRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REMOTE_PATTERN_ID,
    canonical_name: '今、～',
    normalized_key: '今、',
    aliases: [],
    short_meaning: 'right now (remote wording)',
    provenance: 'manual',
    created_at: '2026-09-18T20:42:02.000Z',
    updated_at: '2026-09-18T20:42:33.000Z',
    version: 2,
    ...overrides,
  };
}

describe('grammar pattern duplicate adoption', () => {
  beforeEach(() => {
    resetDbForTests(`sync-adopt-${createId('db')}`);
    fake.calls.length = 0;
    fake.state.result = { data: null, error: null };
  });

  it('adopts the remote pattern and repoints links, relationships and study items (and their queued pushes)', async () => {
    const local = await ensureGrammarPattern('今、～', { shortMeaning: 'local wording' });
    const other = await ensureGrammarPattern('それで', {});
    const link = await ensureSentenceGrammar('sent_1', local.id, {});
    const relationship = await ensureGrammarRelationship(local.id, other.id, 'commonly_confused');
    const studyItem = await ensureStudyItem('grammarPattern', local.id, 'grammar_completion');
    const db = getDb();
    for (const [entity, recordId, payload] of [
      ['sentence_grammar', link.id, link],
      ['grammar_relationships', relationship.id, relationship],
      ['study_items', studyItem.id, studyItem],
    ] as const) {
      await enqueueMutation({ entity, recordId, operation: 'upsert', expectedVersion: null, payload });
    }

    await remapDuplicateEntityId('grammar_patterns', local.id, remotePatternRow());

    // the local duplicate is gone, the remote row (with its wording) is adopted
    expect(await db.grammarPatterns.get(local.id)).toBeUndefined();
    expect((await db.grammarPatterns.get(REMOTE_PATTERN_ID))?.shortMeaning).toBe('right now (remote wording)');
    expect(await db.syncRecordMeta.get(`grammar_patterns:${local.id}`)).toBeUndefined();
    expect((await db.syncRecordMeta.get(`grammar_patterns:${REMOTE_PATTERN_ID}`))?.version).toBe(2);

    // sentence link follows, locally and in its queued push
    expect((await db.sentenceGrammar.get(link.id))?.grammarPatternId).toBe(REMOTE_PATTERN_ID);
    const linkQueued = await db.syncQueue.where('[entity+recordId]').equals(['sentence_grammar', link.id]).first();
    expect((linkQueued?.payload as { grammarPatternId: string }).grammarPatternId).toBe(REMOTE_PATTERN_ID);

    // relationship follows and stays in canonical (a < b) order
    const rel = await db.grammarRelationships.get(relationship.id);
    const expected = [REMOTE_PATTERN_ID, other.id].sort();
    expect([rel?.patternAId, rel?.patternBId]).toEqual(expected);
    const relQueued = await db.syncQueue.where('[entity+recordId]').equals(['grammar_relationships', relationship.id]).first();
    expect([(relQueued?.payload as { patternAId: string }).patternAId, (relQueued?.payload as { patternBId: string }).patternBId]).toEqual(expected);

    // study item follows
    expect((await db.studyItems.get(studyItem.id))?.subjectId).toBe(REMOTE_PATTERN_ID);
    const studyQueued = await db.syncQueue.where('[entity+recordId]').equals(['study_items', studyItem.id]).first();
    expect((studyQueued?.payload as { subjectId: string }).subjectId).toBe(REMOTE_PATTERN_ID);
  });

  it('re-canonicalizes a relationship when the adopted id flips the a/b order', async () => {
    const local = await ensureGrammarPattern('～ています', {});
    const other = await ensureGrammarPattern('それで', {});
    const relationship = await ensureGrammarRelationship(local.id, other.id, 'commonly_confused');
    // an adopted id that sorts AFTER `other` regardless of the local id's position
    const remoteRow = remotePatternRow({ id: 'grammar_pattern_zzzz-remote', normalized_key: 'ています' });
    await remapDuplicateEntityId('grammar_patterns', local.id, remoteRow);
    const rel = await getDb().grammarRelationships.get(relationship.id);
    expect(rel!.patternAId < rel!.patternBId).toBe(true);
    expect([rel!.patternAId, rel!.patternBId].sort()).toEqual([other.id, 'grammar_pattern_zzzz-remote'].sort());
  });

  it('does not merge a study item that already exists for the adopted pattern (left as-is, no throw)', async () => {
    const local = await ensureGrammarPattern('今、～', {});
    const mine = await ensureStudyItem('grammarPattern', local.id, 'grammar_completion');
    const theirs = await ensureStudyItem('grammarPattern', REMOTE_PATTERN_ID, 'grammar_completion');
    await remapDuplicateEntityId('grammar_patterns', local.id, remotePatternRow());
    const db = getDb();
    expect((await db.studyItems.get(mine.id))?.subjectId).toBe(local.id); // unmerged, not silently reassigned
    expect((await db.studyItems.get(theirs.id))?.subjectId).toBe(REMOTE_PATTERN_ID);
  });

  it('leaves unrelated patterns, links and study items alone', async () => {
    const local = await ensureGrammarPattern('今、～', {});
    const bystander = await ensureGrammarPattern('それで', {});
    const bystanderLink = await ensureSentenceGrammar('sent_9', bystander.id, {});
    const bystanderStudy = await ensureStudyItem('grammarPattern', bystander.id, 'grammar_completion');
    await remapDuplicateEntityId('grammar_patterns', local.id, remotePatternRow());
    const db = getDb();
    expect(await db.grammarPatterns.get(bystander.id)).toBeDefined();
    expect((await db.sentenceGrammar.get(bystanderLink.id))?.grammarPatternId).toBe(bystander.id);
    expect((await db.studyItems.get(bystanderStudy.id))?.subjectId).toBe(bystander.id);
  });
});

describe('sentence_grammar / grammar_relationships duplicate adoption', () => {
  beforeEach(() => {
    resetDbForTests(`sync-adopt-${createId('db')}`);
    fake.calls.length = 0;
  });

  it('replaces a local duplicate link with the remote row (same sentence + pattern, different id)', async () => {
    const pattern = await ensureGrammarPattern('今、～', {});
    const link = await ensureSentenceGrammar('sent_1', pattern.id, { occurrenceExplanation: 'local note' });
    await remapDuplicateEntityId('sentence_grammar', link.id, {
      id: 'sg_remote',
      sentence_id: 'sent_1',
      grammar_pattern_id: pattern.id,
      confirmed_by_learner: true,
      source: 'manual',
      created_at: '2026-09-18T20:50:00.000Z',
      updated_at: '2026-09-18T20:50:00.000Z',
      version: 3,
    });
    const db = getDb();
    expect(await db.sentenceGrammar.get(link.id)).toBeUndefined();
    expect((await db.sentenceGrammar.get('sg_remote'))?.confirmedByLearner).toBe(true);
    expect((await db.syncRecordMeta.get('sentence_grammar:sg_remote'))?.version).toBe(3);
  });

  it('replaces a local duplicate relationship with the remote row', async () => {
    const a = await ensureGrammarPattern('今、～', {});
    const b = await ensureGrammarPattern('それで', {});
    const rel = await ensureGrammarRelationship(a.id, b.id, 'commonly_confused');
    await remapDuplicateEntityId('grammar_relationships', rel.id, {
      id: 'gr_remote',
      pattern_a_id: rel.patternAId,
      pattern_b_id: rel.patternBId,
      relationship_type: 'commonly_confused',
      observed_count: 4,
      last_observed_at: '2026-09-18T20:50:00.000Z',
      created_at: '2026-09-18T20:50:00.000Z',
      updated_at: '2026-09-18T20:50:00.000Z',
      version: 2,
    });
    const db = getDb();
    expect(await db.grammarRelationships.get(rel.id)).toBeUndefined();
    expect((await db.grammarRelationships.get('gr_remote'))?.observedCount).toBe(4);
  });
});

describe('adoptRemoteDuplicate remote lookup', () => {
  beforeEach(() => {
    resetDbForTests(`sync-adopt-${createId('db')}`);
    fake.calls.length = 0;
    fake.state.result = { data: null, error: null };
  });

  const lookups: [Parameters<typeof adoptRemoteDuplicate>[0], Record<string, unknown>, [string, unknown][]][] = [
    ['grammar_patterns', { normalized_key: 'ています' }, [['normalized_key', 'ています']]],
    [
      'sentence_grammar',
      { sentence_id: 's1', grammar_pattern_id: 'p1' },
      [['sentence_id', 's1'], ['grammar_pattern_id', 'p1']],
    ],
    [
      'grammar_relationships',
      { pattern_a_id: 'a', pattern_b_id: 'b', relationship_type: 'commonly_confused' },
      [['pattern_a_id', 'a'], ['pattern_b_id', 'b'], ['relationship_type', 'commonly_confused']],
    ],
    ['kanji', { character: '大' }, [['character', '大']]],
    ['vocabulary_items', { expression: '大学', reading: 'だいがく' }, [['expression', '大学'], ['reading', 'だいがく']]],
  ];

  for (const [entity, row, eqs] of lookups) {
    it(`${entity}: looks up the live remote row by its natural key (${eqs.map((e) => e[0]).join(' + ')})`, async () => {
      fake.state.result = { data: null, error: null };
      expect(await adoptRemoteDuplicate(entity, 'local_1', row)).toBe(false); // nothing remote -> not adopted
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]!.table).toBe(entity);
      expect(fake.calls[0]!.eqs).toEqual(eqs);
      expect(fake.calls[0]!.is).toEqual([['deleted_at', null]]); // never adopts a soft-deleted row
    });
  }

  it('does not adopt when the "duplicate" is the row itself, or the lookup errors', async () => {
    fake.state.result = { data: { id: 'local_1', version: 1 }, error: null };
    expect(await adoptRemoteDuplicate('grammar_patterns', 'local_1', { normalized_key: 'x' })).toBe(false);
    fake.state.result = { data: null, error: { message: 'boom' } };
    expect(await adoptRemoteDuplicate('grammar_patterns', 'local_1', { normalized_key: 'x' })).toBe(false);
  });

  it('adopts end to end: finds the remote row, remaps locally, reports success', async () => {
    const local = await ensureGrammarPattern('今、～', {});
    fake.state.result = { data: remotePatternRow(), error: null };
    expect(await adoptRemoteDuplicate('grammar_patterns', local.id, { normalized_key: '今、' })).toBe(true);
    const db = getDb();
    expect(await db.grammarPatterns.get(local.id)).toBeUndefined();
    expect(await db.grammarPatterns.get(REMOTE_PATTERN_ID)).toBeDefined();
  });
});
