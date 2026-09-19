import type { EntityTable } from 'dexie';

import { getDb } from '../db/database';
import {
  bumpQueueRetry,
  dedupeQueueRows,
  ensureSyncMeta,
  listPendingMutations,
  putRecordMeta,
  recordMetaKey,
  removeQueueItem,
  addConflict,
  updateSyncMeta,
  getRecordMeta,
  hasOpenConflict,
  sweepNoopConflicts,
} from './queue';
import {
  idColumnForEntity,
  remoteToAnalysis,
  remoteToBook,
  remoteToBookSentence,
  remoteToCardIssueReport,
  remoteToGrammarPattern,
  remoteToGrammarRelationship,
  remoteToImportBatch,
  remoteToInbox,
  remoteToKanji,
  remoteToPitchDrillAttempt,
  remoteToPlannerSession,
  remoteToReferenceAudio,
  remoteToReview,
  remoteToSentence,
  remoteToSentenceGrammar,
  remoteToSentenceVocabulary,
  remoteToStudyItem,
  remoteToSyncIssueReport,
  remoteToVocabularyConfusion,
  remoteToVocabularyItem,
  remoteToVocabularyKanji,
  toRemoteRow,
} from './mappers';
import { hydrateMissingReferenceAudio } from './audioSync';
import { getSupabase } from './supabaseClient';
import { conflictContentsMatch } from './conflictDiff';
import { syncLog } from './logger';
import type { SyncEntity, SyncQueueItem } from './types';

const PULL_PAGE_SIZE = 100;
/** Cap on `SyncMetaState.deferredPullEventIds` — past this, something is
 *  badly wrong and "Re-download everything from cloud" (Settings) is the
 *  real fix, so keep only the most recent ids rather than growing forever. */
const MAX_DEFERRED_PULL_EVENTS = 2000;
/** Chunk size for the `.in('id', …)` re-fetch of deferred events. */
const DEFERRED_FETCH_CHUNK = 200;

let syncInFlight: Promise<void> | null = null;

export async function runSyncCycle(): Promise<void> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    try {
      // Per-item push failures must surface as lastError. Previously they were
      // retried quietly while the cycle still cleared lastError, so the badge
      // stayed on "Pending N" forever (e.g. after a missing SQL migration).
      const pushFailure = await pushMutations();
      await pullChanges();
      const swept = await sweepNoopConflicts();
      if (swept > 0) {
        syncLog('debug', `Auto-resolved ${swept} stale no-diff conflict(s)`, 'CONFLICT_SWEEP');
      }
      // Best-effort, and deliberately NOT awaited: after a cleared cache this is
      // hundreds of downloads, and holding the cycle open kept the status on
      // "syncing" (and Sync now disabled) for minutes. Never fails the cycle.
      void hydrateMissingReferenceAudio().catch((error) => {
        syncLog('warn', 'Reference-audio hydration failed', 'AUDIO_HYDRATE', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
      await updateSyncMeta({
        lastSyncAt: new Date().toISOString(),
        lastError: pushFailure,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      syncLog('error', 'Sync cycle failed', 'SYNC_CYCLE', { message });
      await updateSyncMeta({ lastError: message });
    } finally {
      syncInFlight = null;
    }
  })();
  return syncInFlight;
}

/** Returns a short failure summary when any queue item could not be pushed. Exported for tests. */
export async function pushMutations(): Promise<string | undefined> {
  const supabase = getSupabase();
  if (!supabase) return undefined;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return undefined;

  const collapsed = await dedupeQueueRows();
  if (collapsed > 0) {
    syncLog('warn', `Collapsed ${collapsed} duplicate queue row(s)`, 'QUEUE_DEDUPE', { collapsed });
  }
  const pending = await listPendingMutations();
  syncLog('debug', `Pushing ${pending.length} mutations`);

  let failureCount = 0;
  let firstFailure: string | undefined;

  for (const item of pending) {
    try {
      await pushOne(item, userId);
      await removeQueueItem(item.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'version_conflict') {
        if (LAST_WRITE_WINS_ENTITIES.has(item.entity)) {
          await forcePushOverwrite(item, userId);
        } else {
          await handlePushConflict(item, userId);
        }
        await removeQueueItem(item.id);
        continue;
      }
      syncLog('warn', 'Push failed', 'PUSH_FAIL', {
        entity: item.entity,
        recordId: item.recordId,
        message,
      });
      await bumpQueueRetry(item.id, message);
      failureCount += 1;
      firstFailure ??= `${item.entity}: ${message}`;
    }
  }

  if (!failureCount || !firstFailure) return undefined;
  if (failureCount === 1) return firstFailure;
  return `${firstFailure} (+${failureCount - 1} more)`;
}

async function acknowledgeSyncedVersion(
  entity: SyncEntity,
  recordId: string,
  version: number,
): Promise<void> {
  await putRecordMeta({
    entity,
    recordId,
    version,
    syncedVersion: version,
    updatedAt: new Date().toISOString(),
  });
}

async function pushOne(item: SyncQueueItem, userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase not configured');

  const table = item.entity;
  const idCol = idColumnForEntity(item.entity);

  if (item.operation === 'delete') {
    const { data: existing, error: readError } = await supabase
      .from(table)
      .select('version')
      .eq(idCol, item.recordId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!existing) {
      return;
    }
    if (
      item.expectedVersion != null &&
      Number(existing.version) !== item.expectedVersion
    ) {
      throw new Error('version_conflict');
    }
    const { data: deleted, error } = await supabase
      .from(table)
      .update({
        deleted_at: new Date().toISOString(),
        last_modified_by: userId,
      })
      .eq(idCol, item.recordId)
      .eq('version', existing.version)
      .select('version');
    if (error) throw new Error(error.message);
    if (!deleted?.length) {
      throw new Error('version_conflict');
    }
    const nextVersion = Number(existing.version) + 1;
    await putRecordMeta({
      entity: item.entity,
      recordId: item.recordId,
      version: nextVersion,
      syncedVersion: nextVersion,
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  const localVersion = (await getRecordMeta(item.entity, item.recordId))
    ?.version ?? 1;
  const row = toRemoteRow(item.entity, item.payload, userId, localVersion);

  const { data: existing, error: readError } = await supabase
    .from(table)
    .select('version')
    .eq(idCol, item.recordId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  if (!existing) {
    const { error } = await supabase.from(table).insert(row);
    if (error) {
      if (
        error.code === '23505' &&
        isDedupEntity(item.entity) &&
        (await adoptRemoteDuplicate(item.entity, item.recordId, row))
      ) {
        return;
      }
      if (error.code === '42501') {
        if (await pruneOrphanedGrammarLink(item)) return;
        await requeueMissingPattern(item);
      }
      throw new Error(error.message);
    }
    const writtenVersion = Number(
      (row as { version?: number }).version ?? localVersion,
    );
    await acknowledgeSyncedVersion(
      item.entity,
      item.recordId,
      writtenVersion,
    );
    return;
  }

  if (
    item.expectedVersion != null &&
    Number(existing.version) !== item.expectedVersion
  ) {
    throw new Error('version_conflict');
  }

  const nextVersion = Number(existing.version) + 1;
  const { data: updated, error } = await supabase
    .from(table)
    .update({ ...row, version: nextVersion })
    .eq(idCol, item.recordId)
    .eq('version', existing.version)
    .select('version');
  if (error) throw new Error(error.message);
  if (!updated?.length) {
    throw new Error('version_conflict');
  }

  await acknowledgeSyncedVersion(item.entity, item.recordId, nextVersion);
}

/**
 * A `sentence_grammar` / `grammar_relationships` row whose pattern id no longer
 * exists **locally** can never be pushed: the server's row-level security
 * requires the referenced pattern to exist and be owned by the user, and a
 * pattern that is gone from this device (its duplicate was adopted away, or it
 * was deleted) has no row to push either. It retried forever — 70 times on a
 * laptop, 2026-09-19 — behind a status stuck on "conflict". Since the insert
 * itself failed (`!existing` above), the record never existed on the server, so
 * dropping the local orphan and its queue rows needs no tombstone. Only fires
 * when the pattern is *absent locally*: a merely-not-yet-pushed local pattern
 * (present in Dexie, queued behind) is left to push normally.
 */
async function pruneOrphanedGrammarLink(item: SyncQueueItem): Promise<boolean> {
  const db = getDb();
  const payload = (item.payload ?? {}) as Record<string, unknown>;
  let patternIds: string[];
  if (item.entity === 'sentence_grammar') {
    patternIds = [String(payload.grammarPatternId ?? '')];
  } else if (item.entity === 'grammar_relationships') {
    patternIds = [String(payload.patternAId ?? ''), String(payload.patternBId ?? '')];
  } else {
    return false;
  }
  const present = await Promise.all(
    patternIds.map(async (id) => !!id && (await db.grammarPatterns.get(id)) != null),
  );
  if (present.every(Boolean)) return false;

  await db.transaction(
    'rw',
    [db.sentenceGrammar, db.grammarRelationships, db.syncQueue, db.syncRecordMeta],
    async () => {
      if (item.entity === 'sentence_grammar') await db.sentenceGrammar.delete(item.recordId);
      else await db.grammarRelationships.delete(item.recordId);
      await db.syncRecordMeta.delete(recordMetaKey(item.entity, item.recordId));
      // every queue row for the record, twins included
      await db.syncQueue.where('[entity+recordId]').equals([item.entity, item.recordId]).delete();
    },
  );
  syncLog('warn', 'Dropped an orphaned grammar link (its pattern no longer exists)', 'ORPHAN_PRUNED', {
    entity: item.entity,
    recordId: item.recordId,
    patternIds,
  });
  return true;
}

/**
 * The other half of the orphaned-link case: the pattern a queued link points at
 * *is* still in Dexie, but it isn't on the server and nothing is queued to push
 * it (its queue row was lost), so the link would wait forever on a push that is
 * never attempted. Re-queue the pattern. Its insert then either succeeds or hits
 * the natural-key index and is adopted by `adoptRemoteDuplicate`. The link still
 * fails this cycle and goes through on a later one.
 */
async function requeueMissingPattern(item: SyncQueueItem): Promise<void> {
  if (item.entity !== 'sentence_grammar') return;
  const supabase = getSupabase();
  if (!supabase) return;
  const db = getDb();
  const patternId = String((item.payload as { grammarPatternId?: string } | undefined)?.grammarPatternId ?? '');
  if (!patternId) return;
  const local = await db.grammarPatterns.get(patternId);
  if (!local) return;
  const alreadyQueued = await db.syncQueue
    .where('[entity+recordId]')
    .equals(['grammar_patterns', patternId])
    .count();
  if (alreadyQueued > 0) return;
  const { data: remote } = await supabase.from('grammar_patterns').select('id').eq('id', patternId).maybeSingle();
  if (remote) return; // it's on the server, so the failure is about something else
  const { enqueueMutation } = await import('./queue');
  await enqueueMutation({
    entity: 'grammar_patterns',
    recordId: patternId,
    operation: 'upsert',
    expectedVersion: null,
    payload: local,
  });
  syncLog('warn', 'Re-queued a grammar pattern that a queued link needs but nothing was pushing', 'PATTERN_REQUEUED', {
    patternId,
    linkId: item.recordId,
  });
}

type DedupEntity =
  | 'kanji'
  | 'vocabulary_items'
  | 'grammar_patterns'
  | 'sentence_grammar'
  | 'grammar_relationships';

const DEDUP_ENTITIES = new Set<SyncEntity>([
  'kanji',
  'vocabulary_items',
  'grammar_patterns',
  'sentence_grammar',
  'grammar_relationships',
]);

function isDedupEntity(entity: SyncEntity): entity is DedupEntity {
  return DEDUP_ENTITIES.has(entity);
}

/**
 * These entities are get-or-create, deduped locally by a natural key —
 * `kanji` (character), `vocabulary_items` (expression+reading; repository.ts's
 * ensureKanji/ensureVocabularyItem), `grammar_patterns` (normalized_key;
 * ensureGrammarPattern), and the two grammar link tables (`sentence_grammar`
 * by sentence+pattern, `grammar_relationships` by pair+type). If a device's
 * local cache missed a row that already exists remotely (a stale cursor, or —
 * the 2026-09-19 case — a laptop that hadn't synced since the previous day
 * while another device created the same grammar patterns), get-or-create
 * mints a duplicate with a fresh local id, and its insert hits the remote
 * natural-key unique index (23505) instead of the id-based version_conflict
 * path. That failure is permanent (the insert can never succeed) and it blocked
 * the whole queue behind it ("10 pending", status stuck on "conflict").
 * Recover by adopting the existing remote row's id in place of retrying.
 * Exported for unit tests (with a faked Supabase client) to pin the lookup columns.
 */
export async function adoptRemoteDuplicate(
  entity: DedupEntity,
  localId: string,
  row: Record<string, unknown>,
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const query = supabase.from(entity).select('*').is('deleted_at', null);
  let lookup;
  switch (entity) {
    case 'kanji':
      lookup = query.eq('character', row.character as string);
      break;
    case 'vocabulary_items':
      lookup = query.eq('expression', row.expression as string).eq('reading', row.reading as string);
      break;
    case 'grammar_patterns':
      lookup = query.eq('normalized_key', row.normalized_key as string);
      break;
    case 'sentence_grammar':
      lookup = query
        .eq('sentence_id', row.sentence_id as string)
        .eq('grammar_pattern_id', row.grammar_pattern_id as string);
      break;
    case 'grammar_relationships':
      lookup = query
        .eq('pattern_a_id', row.pattern_a_id as string)
        .eq('pattern_b_id', row.pattern_b_id as string)
        .eq('relationship_type', row.relationship_type as string);
      break;
  }
  const { data: remote, error } = await lookup.maybeSingle();
  // A remote row with our own id would have taken the update path, not this one.
  if (error || !remote || String(remote.id) === localId) return false;

  await remapDuplicateEntityId(entity, localId, remote as Record<string, unknown>);
  syncLog('warn', 'Adopted remote row for duplicate get-or-create insert', 'DEDUP_ADOPT', {
    entity,
    localId,
    remoteId: String(remote.id),
  });
  return true;
}

/**
 * Rewrites a local get-or-create row (and every local link that references
 * it) from `localId` to the id of the already-existing remote row. Exported
 * for unit tests, since the network lookup in adoptRemoteDuplicate isn't
 * testable without a Supabase-mocking harness (this file's existing
 * boundary — see shouldApplyRemoteEvent).
 */
export async function remapDuplicateEntityId(
  entity: DedupEntity,
  oldId: string,
  remoteRow: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  const newId = String(remoteRow.id);
  const remoteVersion = Number(remoteRow.version ?? 1);
  const now = new Date().toISOString();

  await db.transaction(
    'rw',
    [
      db.kanji,
      db.vocabularyItems,
      db.vocabularyKanji,
      db.sentenceVocabulary,
      db.grammarPatterns,
      db.sentenceGrammar,
      db.grammarRelationships,
      db.studyItems,
      db.syncQueue,
      db.syncRecordMeta,
    ],
    async () => {
      switch (entity) {
        case 'kanji':
          await db.kanji.delete(oldId);
          await db.kanji.put(remoteToKanji(remoteRow));
          break;
        case 'vocabulary_items':
          await db.vocabularyItems.delete(oldId);
          await db.vocabularyItems.put(remoteToVocabularyItem(remoteRow));
          break;
        case 'grammar_patterns':
          await db.grammarPatterns.delete(oldId);
          await db.grammarPatterns.put(remoteToGrammarPattern(remoteRow));
          break;
        case 'sentence_grammar':
          await db.sentenceGrammar.delete(oldId);
          await db.sentenceGrammar.put(remoteToSentenceGrammar(remoteRow));
          break;
        case 'grammar_relationships':
          await db.grammarRelationships.delete(oldId);
          await db.grammarRelationships.put(remoteToGrammarRelationship(remoteRow));
          break;
      }

      await db.syncRecordMeta.delete(recordMetaKey(entity, oldId));
      await putRecordMeta({
        entity,
        recordId: newId,
        version: remoteVersion,
        syncedVersion: remoteVersion,
        updatedAt: now,
      });

      if (entity === 'kanji') {
        await remapLinkReferences(db.vocabularyKanji, 'kanjiId', oldId, newId, 'vocabulary_kanji');
      } else if (entity === 'vocabulary_items') {
        await remapLinkReferences(db.vocabularyKanji, 'vocabularyItemId', oldId, newId, 'vocabulary_kanji');
        await remapLinkReferences(db.sentenceVocabulary, 'vocabularyItemId', oldId, newId, 'sentence_vocabulary');
      } else if (entity === 'grammar_patterns') {
        // Everything that points at the abandoned local pattern id must follow
        // the adopted remote one, or it pushes as an orphan.
        await remapLinkReferences(db.sentenceGrammar, 'grammarPatternId', oldId, newId, 'sentence_grammar');
        await remapRelationshipReferences(oldId, newId);
        await remapGrammarStudyItems(oldId, newId);
      }
    },
  );
}

/**
 * Repoints local grammar_relationships from `oldId` to `newId`. A relationship
 * stores its two pattern ids in canonical order (a < b), so swapping one id can
 * flip the order — re-canonicalize, and update any queued push to match.
 */
async function remapRelationshipReferences(oldId: string, newId: string): Promise<void> {
  const db = getDb();
  const asA = await db.grammarRelationships.where('patternAId').equals(oldId).toArray();
  const asB = await db.grammarRelationships.where('patternBId').equals(oldId).toArray();
  const seen = new Set<string>();
  for (const relationship of [...asA, ...asB]) {
    if (seen.has(relationship.id)) continue;
    seen.add(relationship.id);
    let a = relationship.patternAId === oldId ? newId : relationship.patternAId;
    let b = relationship.patternBId === oldId ? newId : relationship.patternBId;
    if (a > b) [a, b] = [b, a];
    const updated = { ...relationship, patternAId: a, patternBId: b };
    await db.grammarRelationships.put(updated);
    await repointQueuedPayloads('grammar_relationships', relationship.id, updated);
  }
}

/**
 * Repoints the local study items (one per activity) that are about the
 * abandoned pattern id. If an item for the same (subject, activity) already
 * exists under `newId` — which can't happen in the stale-cache scenario this
 * exists for, since the device would have pulled that item along with the
 * pattern — it is left alone and logged, rather than merged blind (its reviews
 * would need repointing too).
 */
async function remapGrammarStudyItems(oldId: string, newId: string): Promise<void> {
  const db = getDb();
  const items = await db.studyItems
    .where('[subjectType+subjectId+activityType]')
    .between(['grammarPattern', oldId, ''], ['grammarPattern', oldId, '\uffff'])
    .toArray();
  for (const item of items) {
    const clash = await db.studyItems
      .where('[subjectType+subjectId+activityType]')
      .equals(['grammarPattern', newId, item.activityType])
      .first();
    if (clash) {
      syncLog('warn', 'Grammar study item already exists for adopted pattern; left unmerged', 'DEDUP_STUDY_ITEM_CLASH', {
        studyItemId: item.id,
        existingId: clash.id,
      });
      continue;
    }
    const updated = { ...item, subjectId: newId };
    await db.studyItems.put(updated);
    await repointQueuedPayloads('study_items', item.id, updated);
  }
}

/**
 * Rewrites the payload of **every** queued mutation for a record — not just the
 * first. A record can have more than one queue row (an enqueue race, before
 * `enqueueMutation` became atomic), and a twin left holding the old foreign key
 * fails its push forever.
 */
async function repointQueuedPayloads(
  entity: SyncEntity,
  recordId: string,
  payload: unknown,
): Promise<void> {
  const db = getDb();
  const rows = await db.syncQueue.where('[entity+recordId]').equals([entity, recordId]).toArray();
  for (const row of rows) {
    await db.syncQueue.put({ ...row, payload, lastError: undefined });
  }
}

/** Repoints every local link row's foreign key (and any queued push for it) from `oldId` to `newId`. */
async function remapLinkReferences<T extends { id: string }, F extends keyof T & string>(
  table: EntityTable<T, 'id'>,
  fkField: F,
  oldId: string,
  newId: string,
  syncEntity: SyncEntity,
): Promise<void> {
  const links = await table.where(fkField).equals(oldId).toArray();
  for (const link of links) {
    const updated: T = { ...link, [fkField]: newId };
    await table.put(updated);
    await repointQueuedPayloads(syncEntity, link.id, updated);
  }
}

/**
 * Entities where a push-time version conflict should just overwrite the
 * cloud row with this device's local payload rather than surfacing a
 * manual keep-local/keep-remote/duplicate conflict (ConflictPanel.tsx) —
 * `planner_sessions` is session-execution bookkeeping, not durable
 * content, so silently letting the most recently-pushing device win is an
 * acceptable simplification (confirmed with the user, see
 * docs/STATUS.md).
 */
const LAST_WRITE_WINS_ENTITIES = new Set<SyncEntity>(['planner_sessions']);

/** Unconditionally overwrites the remote row with the local payload, ignoring the CAS mismatch that triggered `version_conflict` — see `LAST_WRITE_WINS_ENTITIES`. */
async function forcePushOverwrite(
  item: SyncQueueItem,
  userId: string,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const idCol = idColumnForEntity(item.entity);
  const localVersion = (await getRecordMeta(item.entity, item.recordId))
    ?.version ?? 1;
  const row = toRemoteRow(item.entity, item.payload, userId, localVersion);

  const { data: existing, error: readError } = await supabase
    .from(item.entity)
    .select('version')
    .eq(idCol, item.recordId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  if (!existing) {
    const { error } = await supabase.from(item.entity).insert(row);
    if (error) throw new Error(error.message);
    await acknowledgeSyncedVersion(item.entity, item.recordId, localVersion);
    return;
  }

  const nextVersion = Number(existing.version) + 1;
  const { error } = await supabase
    .from(item.entity)
    .update({ ...row, version: nextVersion })
    .eq(idCol, item.recordId);
  if (error) throw new Error(error.message);
  await acknowledgeSyncedVersion(item.entity, item.recordId, nextVersion);
  syncLog('warn', 'Last-write-wins overwrite', 'LWW_OVERWRITE', {
    entity: item.entity,
    recordId: item.recordId,
    userId,
  });
}

async function handlePushConflict(
  item: SyncQueueItem,
  userId: string,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const idCol = idColumnForEntity(item.entity);
  const { data: remote } = await supabase
    .from(item.entity)
    .select('*')
    .eq(idCol, item.recordId)
    .maybeSingle();
  if (!remote) return;
  const remoteVersion = Number(remote.version ?? 0);
  const localMeta = await getRecordMeta(item.entity, item.recordId);
  // Align optimistic-lock base to cloud so Keep local / later edits can push.
  await putRecordMeta({
    entity: item.entity,
    recordId: item.recordId,
    version: localMeta?.version ?? remoteVersion,
    syncedVersion: remoteVersion,
    updatedAt: new Date().toISOString(),
    deletedAt: localMeta?.deletedAt,
  });
  // A version_conflict is a raw CAS mismatch — it doesn't mean the content
  // actually diverged. Two near-simultaneous saves that land on the same
  // resulting state (or a queued mutation landing right after another
  // already wrote it) hit this with nothing left to decide; settle those
  // automatically instead of asking the learner to click through a
  // conflict card with no real diff (reported 2026-09-04 — "no other diff
  // lines highlighted").
  if (conflictContentsMatch(item.payload, remote, item.entity)) {
    syncLog('debug', 'Conflict auto-settled: no content difference', 'CONFLICT_NOOP', {
      entity: item.entity,
      recordId: item.recordId,
    });
    return;
  }
  await addConflict({
    entity: item.entity,
    recordId: item.recordId,
    localPayload: item.payload,
    remotePayload: remote,
    localVersion: item.expectedVersion ?? 0,
    remoteVersion,
  });
  syncLog('warn', 'Conflict recorded', 'CONFLICT', {
    entity: item.entity,
    recordId: item.recordId,
    userId,
  });
}

async function pullChanges(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return;

  const meta = await ensureSyncMeta();
  const deferred = new Set<number>(meta.deferredPullEventIds ?? []);

  // 1. Re-attempt events an earlier pull declined for a transient reason
  //    (local pending write / open conflict / meta that looked newer). The
  //    forward cursor already moved past them, so without this a momentary
  //    skip becomes a permanent missing row.
  if (deferred.size > 0) {
    const ids = [...deferred].sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i += DEFERRED_FETCH_CHUNK) {
      const chunk = ids.slice(i, i + DEFERRED_FETCH_CHUNK);
      const { data: events, error } = await supabase
        .from('sync_events')
        .select('*')
        .eq('owner_id', userId)
        .in('id', chunk)
        .order('id', { ascending: true });
      if (error) throw new Error(error.message);
      const seen = new Set((events ?? []).map((event) => Number(event.id)));
      // An id we can no longer see shouldn't happen (events are never
      // deleted) — but don't spin on it forever if it does.
      for (const id of chunk) if (!seen.has(id)) deferred.delete(id);
      if (events?.length) {
        const { skipped } = await applyRemoteEventsBatch(events);
        for (const id of seen) if (!skipped.includes(id)) deferred.delete(id);
      }
    }
    await updateSyncMeta({ deferredPullEventIds: [...deferred] });
  }

  // 2. Forward pull of anything past the cursor.
  let cursor = meta.lastPullEventId;
  let keepGoing = true;
  while (keepGoing) {
    const { data: events, error } = await supabase
      .from('sync_events')
      .select('*')
      .eq('owner_id', userId)
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(PULL_PAGE_SIZE);
    if (error) throw new Error(error.message);
    if (!events?.length) break;

    const { skipped } = await applyRemoteEventsBatch(events);
    for (const id of skipped) deferred.add(id);
    cursor = Number(events[events.length - 1]!.id);

    let next = [...deferred];
    if (next.length > MAX_DEFERRED_PULL_EVENTS) {
      next = next.sort((a, b) => b - a).slice(0, MAX_DEFERRED_PULL_EVENTS);
      deferred.clear();
      for (const id of next) deferred.add(id);
    }
    await updateSyncMeta({ lastPullEventId: cursor, deferredPullEventIds: next });
    keepGoing = events.length === PULL_PAGE_SIZE;
  }
}

/**
 * Local-only checks deciding whether a remote sync_events row is worth
 * fetching at all — split out of applyRemoteEvent so pullChanges can run
 * these (cheap Dexie reads) before doing any network fetch, and batch the
 * fetch for everything that survives. `pending` can be pre-fetched once per
 * page instead of once per event. Exported for unit tests.
 */
export async function shouldApplyRemoteEvent(
  entity: SyncEntity,
  recordId: string,
  op: string,
  version: number,
  pending?: SyncQueueItem[],
): Promise<boolean> {
  const pendingItems = pending ?? (await listPendingMutations());
  const hasLocalPending = pendingItems.some(
    (p) => p.entity === entity && p.recordId === recordId,
  );
  if (hasLocalPending) {
    // Leave for push/conflict handling.
    return false;
  }

  if (await hasOpenConflict(entity, recordId)) {
    // Keep local data until the user resolves Keep local / Keep remote.
    return false;
  }

  const localMeta = await getRecordMeta(entity, recordId);
  if (localMeta && localMeta.version >= version && op !== 'delete') {
    // Trust "already have this version" only if the row is actually present.
    // Stale record-meta (row dropped locally by a partial clear / failed
    // write, meta kept) otherwise makes every future event for it skip
    // forever — the permanent-missing-row bug this guards against.
    if (await localRecordExists(entity, recordId)) return false;
  }

  return true;
}

/** Whether the Dexie row for a synced record is present locally. Mirrors
 *  applyRemoteDelete's entity→table switch. */
async function localRecordExists(entity: SyncEntity, recordId: string): Promise<boolean> {
  const db = getDb();
  switch (entity) {
    case 'books':
      return (await db.books.get(recordId)) != null;
    case 'sentences':
      return (await db.sentences.get(recordId)) != null;
    case 'book_sentences':
      return (await db.bookSentences.get(recordId)) != null;
    case 'analyses':
      return (await db.analyses.get(recordId)) != null;
    case 'import_batches':
      return (await db.importBatches.get(recordId)) != null;
    case 'inbox':
      return (await db.inbox.get(recordId)) != null;
    case 'reference_audio':
      return (await db.sentenceAudio.get(recordId)) != null;
    case 'study_items':
      return (await db.studyItems.get(recordId)) != null;
    case 'reviews':
      return (await db.reviews.get(recordId)) != null;
    case 'vocabulary_items':
      return (await db.vocabularyItems.get(recordId)) != null;
    case 'sentence_vocabulary':
      return (await db.sentenceVocabulary.get(recordId)) != null;
    case 'kanji':
      return (await db.kanji.get(recordId)) != null;
    case 'vocabulary_kanji':
      return (await db.vocabularyKanji.get(recordId)) != null;
    case 'vocabulary_confusions':
      return (await db.vocabularyConfusions.get(recordId)) != null;
    case 'card_issue_reports':
      return (await db.cardIssueReports.get(recordId)) != null;
    case 'grammar_patterns':
      return (await db.grammarPatterns.get(recordId)) != null;
    case 'sentence_grammar':
      return (await db.sentenceGrammar.get(recordId)) != null;
    case 'grammar_relationships':
      return (await db.grammarRelationships.get(recordId)) != null;
    case 'planner_sessions':
      return (await db.plannerSessions.get(recordId)) != null;
    case 'sync_issue_reports':
      return (await db.syncIssueReports.get(recordId)) != null;
    case 'pitch_drill_attempts':
      return (await db.pitchDrillAttempts.get(recordId)) != null;
    default:
      // Unknown entity — assume present so we don't loop re-fetching it.
      return true;
  }
}

/**
 * Decide delete vs. upsert for an already-fetched (possibly absent) remote
 * row. Shared by applyRemoteEvent's single-row fetch and
 * applyRemoteEventsBatch's batched fetch, so the two paths can't silently
 * diverge on this decision.
 */
async function applyFetchedRemote(
  entity: SyncEntity,
  recordId: string,
  version: number,
  remote: Record<string, unknown> | null | undefined,
): Promise<void> {
  if (!remote || remote.deleted_at) {
    await applyRemoteDelete(entity, recordId, version);
    return;
  }
  // Prefer the fetched row's real version over the triggering event's — when
  // re-applying a deferred (older) event the two can differ, and record-meta
  // should track what we actually wrote, not the stale event.
  const effectiveVersion =
    remote.version != null ? Number(remote.version) : version;
  await applyRemoteUpsert(entity, remote, effectiveVersion);
}

/** Apply a remote sync_events row. Exported for unit tests. */
export async function applyRemoteEvent(
  entity: SyncEntity,
  recordId: string,
  op: string,
  version: number,
): Promise<void> {
  if (!(await shouldApplyRemoteEvent(entity, recordId, op, version))) return;

  const supabase = getSupabase();
  if (!supabase) return;
  const idCol = idColumnForEntity(entity);
  const { data: remote, error } = await supabase
    .from(entity)
    .select('*')
    .eq(idCol, recordId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  await applyFetchedRemote(entity, recordId, version, remote as Record<string, unknown> | null);
}

/**
 * Apply a whole page of sync_events rows, batching the remote fetch by
 * entity (one `.in(idCol, recordIds)` query per entity present in the page)
 * instead of one query per row. A large one-time backlog (e.g. a bulk
 * catalog import) can be thousands of rows; fetching each individually is
 * thousands of sequential round-trips, slow enough on a mobile connection to
 * look permanently stuck. Preserves applyRemoteEvent's per-event skip
 * checks and local-write order — see comment below on why grouping by
 * entity is safe for cross-entity (parent/child) dependencies.
 */
async function applyRemoteEventsBatch(
  events: Array<{
    id: number | string;
    entity: string;
    record_id: unknown;
    op: string;
    version: unknown;
  }>,
): Promise<{ skipped: number[] }> {
  const pending = await listPendingMutations();

  type PendingFetch = { entity: SyncEntity; recordId: string; version: number };
  const toFetch: PendingFetch[] = [];
  const skipped: number[] = [];
  for (const event of events) {
    const entity = event.entity as SyncEntity;
    const recordId = String(event.record_id);
    const op = String(event.op);
    const version = Number(event.version);
    if (await shouldApplyRemoteEvent(entity, recordId, op, version, pending)) {
      toFetch.push({ entity, recordId, version });
    } else {
      skipped.push(Number(event.id));
    }
  }
  if (!toFetch.length) return { skipped };

  const supabase = getSupabase();
  if (!supabase) return { skipped };

  // Grouping by entity (rather than fetching in original event order) is
  // safe for our fixed, type-level dependency graph (kanji/vocabulary_items
  // before sentence_vocabulary/vocabulary_kanji/vocabulary_confusions,
  // study_items before reviews, etc.): as long as an entity's *first* occurrence in the page
  // follows real event order (it does — Map preserves insertion order, and
  // events are processed in ascending id order), every parent-entity event
  // in the page is applied before any child-entity event, which is at least
  // as strict as strict chronological order and never looser.
  const byEntity = new Map<SyncEntity, PendingFetch[]>();
  for (const item of toFetch) {
    const list = byEntity.get(item.entity);
    if (list) list.push(item);
    else byEntity.set(item.entity, [item]);
  }

  for (const [entity, items] of byEntity) {
    const idCol = idColumnForEntity(entity);
    const recordIds = [...new Set(items.map((item) => item.recordId))];
    const { data: rows, error } = await supabase
      .from(entity)
      .select('*')
      .in(idCol, recordIds);
    if (error) throw new Error(error.message);
    const byRecordId = new Map(
      (rows ?? []).map((row) => [
        String((row as Record<string, unknown>)[idCol]),
        row as Record<string, unknown>,
      ]),
    );
    for (const item of items) {
      await applyFetchedRemote(item.entity, item.recordId, item.version, byRecordId.get(item.recordId));
    }
  }

  return { skipped };
}

async function applyRemoteDelete(
  entity: SyncEntity,
  recordId: string,
  version: number,
): Promise<void> {
  const db = getDb();
  switch (entity) {
    case 'books':
      await db.bookSentences.where('bookId').equals(recordId).delete();
      await db.books.delete(recordId);
      break;
    case 'sentences':
      await db.sentences.delete(recordId);
      break;
    case 'book_sentences':
      await db.bookSentences.delete(recordId);
      break;
    case 'analyses':
      await db.analyses.delete(recordId);
      break;
    case 'import_batches':
      await db.importBatches.delete(recordId);
      break;
    case 'inbox':
      await db.inbox.delete(recordId);
      break;
    case 'reference_audio':
      await db.sentenceAudio.delete(recordId);
      break;
    case 'study_items':
      await db.studyItems.delete(recordId);
      break;
    case 'reviews':
      await db.reviews.delete(recordId);
      break;
    case 'vocabulary_items':
      await db.vocabularyItems.delete(recordId);
      break;
    case 'sentence_vocabulary':
      await db.sentenceVocabulary.delete(recordId);
      break;
    case 'kanji':
      await db.kanji.delete(recordId);
      break;
    case 'vocabulary_kanji':
      await db.vocabularyKanji.delete(recordId);
      break;
    case 'vocabulary_confusions':
      await db.vocabularyConfusions.delete(recordId);
      break;
    case 'card_issue_reports':
      await db.cardIssueReports.delete(recordId);
      break;
    case 'grammar_patterns':
      await db.grammarPatterns.delete(recordId);
      break;
    case 'sentence_grammar':
      await db.sentenceGrammar.delete(recordId);
      break;
    case 'grammar_relationships':
      await db.grammarRelationships.delete(recordId);
      break;
    case 'planner_sessions':
      await db.plannerSessions.delete(recordId);
      break;
    case 'sync_issue_reports':
      await db.syncIssueReports.delete(recordId);
      break;
    case 'pitch_drill_attempts':
      await db.pitchDrillAttempts.delete(recordId);
      break;
  }
  await putRecordMeta({
    entity,
    recordId,
    version,
    syncedVersion: version,
    updatedAt: new Date().toISOString(),
    deletedAt: new Date().toISOString(),
  });
}

/** Apply one already-fetched remote row to Dexie. Exported for unit tests. */
export async function applyRemoteUpsert(
  entity: SyncEntity,
  remote: Record<string, unknown>,
  version: number,
): Promise<void> {
  const db = getDb();
  switch (entity) {
    case 'books':
      await db.books.put(remoteToBook(remote));
      break;
    case 'sentences':
      await db.sentences.put(remoteToSentence(remote));
      break;
    case 'book_sentences':
      await db.bookSentences.put(remoteToBookSentence(remote));
      break;
    case 'analyses':
      await db.analyses.put(remoteToAnalysis(remote));
      break;
    case 'import_batches':
      await db.importBatches.put(remoteToImportBatch(remote));
      break;
    case 'inbox':
      await db.inbox.put(remoteToInbox(remote));
      break;
    case 'reference_audio': {
      // Metadata only — blobs download on demand (hydrateMissingReferenceAudio
      // after the pull, or the play-time self-heal in nativeAudio.ts).
      const meta = remoteToReferenceAudio(remote);
      const existing = await db.sentenceAudio.get(meta.id);
      if (existing) {
        await db.sentenceAudio.put({
          ...existing,
          sentenceId: meta.sentenceId,
          sourceId: meta.sourceId,
          sourceSentenceId: meta.sourceSentenceId,
          sourceTitle: meta.sourceTitle,
          sourceUrl: meta.sourceUrl,
          mimeType: meta.mimeType,
          durationMs: meta.durationMs,
          startMs: meta.startMs,
          endMs: meta.endMs,
        });
        break;
      }
      // No local row yet (audio imported on another device, or a
      // re-segmentation backfill). Create a blob-less placeholder so the
      // sentence shows its audio affordance; the blob hydrates separately.
      const syncMeta = await ensureSyncMeta();
      if (!syncMeta.syncReferenceAudio) break;
      await db.sentenceAudio.put({
        id: meta.id,
        sentenceId: meta.sentenceId,
        sourceId: meta.sourceId,
        sourceSentenceId: meta.sourceSentenceId,
        sourceTitle: meta.sourceTitle,
        sourceUrl: meta.sourceUrl,
        mimeType: meta.mimeType,
        durationMs: meta.durationMs,
        startMs: meta.startMs,
        endMs: meta.endMs,
        blob: new Blob([], { type: meta.mimeType }),
        importedAt: meta.importedAt,
      });
      break;
    }
    case 'study_items':
      await db.studyItems.put(remoteToStudyItem(remote));
      break;
    case 'reviews':
      await db.reviews.put(remoteToReview(remote));
      break;
    case 'vocabulary_items':
      await db.vocabularyItems.put(remoteToVocabularyItem(remote));
      break;
    case 'sentence_vocabulary':
      await db.sentenceVocabulary.put(remoteToSentenceVocabulary(remote));
      break;
    case 'kanji':
      await db.kanji.put(remoteToKanji(remote));
      break;
    case 'vocabulary_kanji':
      await db.vocabularyKanji.put(remoteToVocabularyKanji(remote));
      break;
    case 'vocabulary_confusions':
      await db.vocabularyConfusions.put(remoteToVocabularyConfusion(remote));
      break;
    case 'card_issue_reports':
      await db.cardIssueReports.put(remoteToCardIssueReport(remote));
      break;
    case 'grammar_patterns':
      await db.grammarPatterns.put(remoteToGrammarPattern(remote));
      break;
    case 'sentence_grammar':
      await db.sentenceGrammar.put(remoteToSentenceGrammar(remote));
      break;
    case 'grammar_relationships':
      await db.grammarRelationships.put(remoteToGrammarRelationship(remote));
      break;
    case 'planner_sessions':
      await db.plannerSessions.put(remoteToPlannerSession(remote));
      break;
    case 'sync_issue_reports':
      await db.syncIssueReports.put(remoteToSyncIssueReport(remote));
      break;
    case 'pitch_drill_attempts':
      await db.pitchDrillAttempts.put(remoteToPitchDrillAttempt(remote));
      break;
  }
  const recordId =
    entity === 'analyses' || entity === 'inbox'
      ? String(remote.sentence_id)
      : String(remote.id);
  await putRecordMeta({
    entity,
    recordId,
    version,
    syncedVersion: version,
    updatedAt: String(remote.updated_at ?? new Date().toISOString()),
  });
}

/** Upload all local data for first-login migration (excludes audio blobs). */
export async function uploadAllLocalData(userId: string): Promise<void> {
  const db = getDb();
  const books = await db.books.toArray();
  const sentences = await db.sentences.toArray();
  const bookSentences = await db.bookSentences.toArray();
  const analyses = await db.analyses.toArray();
  const batches = await db.importBatches.toArray();
  const inbox = await db.inbox.toArray();
  const studyItems = await db.studyItems.toArray();
  const reviews = await db.reviews.toArray();
  const kanjiRows = await db.kanji.toArray();
  const vocabularyItems = await db.vocabularyItems.toArray();
  const sentenceVocabulary = await db.sentenceVocabulary.toArray();
  const vocabularyKanji = await db.vocabularyKanji.toArray();
  const vocabularyConfusions = await db.vocabularyConfusions.toArray();
  const cardIssueReports = await db.cardIssueReports.toArray();
  const grammarPatterns = await db.grammarPatterns.toArray();
  const sentenceGrammar = await db.sentenceGrammar.toArray();
  const grammarRelationships = await db.grammarRelationships.toArray();
  const plannerSessions = await db.plannerSessions.toArray();
  const syncIssueReports = await db.syncIssueReports.toArray();
  const pitchDrillAttempts = await db.pitchDrillAttempts.toArray();

  for (const book of books) {
    await trackAndEnqueue('books', book.id, book);
  }
  for (const sentence of sentences) {
    await trackAndEnqueue('sentences', sentence.id, sentence);
  }
  for (const bs of bookSentences) {
    await trackAndEnqueue('book_sentences', bs.id, bs);
  }
  for (const analysis of analyses) {
    await trackAndEnqueue('analyses', analysis.sentenceId, analysis);
  }
  for (const batch of batches) {
    await trackAndEnqueue('import_batches', batch.id, batch);
  }
  for (const item of inbox) {
    await trackAndEnqueue('inbox', item.sentenceId, item);
  }
  for (const studyItem of studyItems) {
    await trackAndEnqueue('study_items', studyItem.id, studyItem);
  }
  for (const review of reviews) {
    await trackAndEnqueue('reviews', review.id, review);
  }
  for (const kanjiRow of kanjiRows) {
    await trackAndEnqueue('kanji', kanjiRow.id, kanjiRow);
  }
  for (const item of vocabularyItems) {
    await trackAndEnqueue('vocabulary_items', item.id, item);
  }
  for (const link of sentenceVocabulary) {
    await trackAndEnqueue('sentence_vocabulary', link.id, link);
  }
  for (const link of vocabularyKanji) {
    await trackAndEnqueue('vocabulary_kanji', link.id, link);
  }
  for (const confusion of vocabularyConfusions) {
    await trackAndEnqueue('vocabulary_confusions', confusion.id, confusion);
  }
  for (const report of cardIssueReports) {
    await trackAndEnqueue('card_issue_reports', report.id, report);
  }
  // grammarPatterns before sentenceGrammar/grammarRelationships — both
  // reference it, same parent-before-child ordering as kanji/vocabularyItems
  // before their link tables above.
  for (const pattern of grammarPatterns) {
    await trackAndEnqueue('grammar_patterns', pattern.id, pattern);
  }
  for (const link of sentenceGrammar) {
    await trackAndEnqueue('sentence_grammar', link.id, link);
  }
  for (const relationship of grammarRelationships) {
    await trackAndEnqueue('grammar_relationships', relationship.id, relationship);
  }
  for (const session of plannerSessions) {
    await trackAndEnqueue('planner_sessions', session.id, session);
  }
  for (const report of syncIssueReports) {
    await trackAndEnqueue('sync_issue_reports', report.id, report);
  }
  for (const attempt of pitchDrillAttempts) {
    await trackAndEnqueue('pitch_drill_attempts', attempt.id, attempt);
  }

  await updateSyncMeta({ userId, migrationChoice: 'upload' });
  await runSyncCycle();
}

async function trackAndEnqueue(
  entity: SyncEntity,
  recordId: string,
  payload: unknown,
): Promise<void> {
  await putRecordMeta({
    entity,
    recordId,
    version: 1,
    syncedVersion: 0,
    updatedAt: new Date().toISOString(),
  });
  const { enqueueMutation } = await import('./queue');
  await enqueueMutation({
    entity,
    recordId,
    operation: 'upsert',
    expectedVersion: null,
    payload,
  });
}

/** Replace local Dexie tables with a full pull of the signed-in user's cloud data. */
export async function replaceLocalWithCloud(userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase not configured');
  const db = getDb();

  await db.transaction(
    'rw',
    [
      db.books,
      db.sentences,
      db.bookSentences,
      db.analyses,
      db.importBatches,
      db.inbox,
      db.studyItems,
      db.reviews,
      db.kanji,
      db.vocabularyItems,
      db.sentenceVocabulary,
      db.vocabularyKanji,
      db.vocabularyConfusions,
      db.cardIssueReports,
      db.grammarPatterns,
      db.sentenceGrammar,
      db.grammarRelationships,
      db.plannerSessions,
      db.syncIssueReports,
      db.pitchDrillAttempts,
      db.syncQueue,
      db.syncRecordMeta,
      db.syncConflicts,
    ],
    async () => {
      await db.books.clear();
      await db.sentences.clear();
      await db.bookSentences.clear();
      await db.analyses.clear();
      await db.importBatches.clear();
      await db.inbox.clear();
      await db.studyItems.clear();
      await db.reviews.clear();
      await db.kanji.clear();
      await db.vocabularyItems.clear();
      await db.sentenceVocabulary.clear();
      await db.vocabularyKanji.clear();
      await db.vocabularyConfusions.clear();
      await db.cardIssueReports.clear();
      await db.grammarPatterns.clear();
      await db.sentenceGrammar.clear();
      await db.grammarRelationships.clear();
      await db.plannerSessions.clear();
      await db.syncIssueReports.clear();
      await db.pitchDrillAttempts.clear();
      await db.syncQueue.clear();
      await db.syncRecordMeta.clear();
      await db.syncConflicts.clear();
    },
  );

  await pullFullTable('books', userId, async (rows) => {
    await db.books.bulkPut(rows.map((r) => remoteToBook(r)));
  });
  await pullFullTable('sentences', userId, async (rows) => {
    await db.sentences.bulkPut(rows.map((r) => remoteToSentence(r)));
  });
  await pullFullTable('book_sentences', userId, async (rows) => {
    await db.bookSentences.bulkPut(rows.map((r) => remoteToBookSentence(r)));
  });
  await pullFullTable('analyses', userId, async (rows) => {
    await db.analyses.bulkPut(rows.map((r) => remoteToAnalysis(r)));
  });
  await pullFullTable('import_batches', userId, async (rows) => {
    await db.importBatches.bulkPut(rows.map((r) => remoteToImportBatch(r)));
  });
  await pullFullTable('inbox', userId, async (rows) => {
    await db.inbox.bulkPut(rows.map((r) => remoteToInbox(r)));
  });
  await pullFullTable('study_items', userId, async (rows) => {
    await db.studyItems.bulkPut(rows.map((r) => remoteToStudyItem(r)));
  });
  await pullFullTable('reviews', userId, async (rows) => {
    await db.reviews.bulkPut(rows.map((r) => remoteToReview(r)));
  });
  await pullFullTable('kanji', userId, async (rows) => {
    await db.kanji.bulkPut(rows.map((r) => remoteToKanji(r)));
  });
  await pullFullTable('vocabulary_items', userId, async (rows) => {
    await db.vocabularyItems.bulkPut(rows.map((r) => remoteToVocabularyItem(r)));
  });
  await pullFullTable('sentence_vocabulary', userId, async (rows) => {
    await db.sentenceVocabulary.bulkPut(
      rows.map((r) => remoteToSentenceVocabulary(r)),
    );
  });
  await pullFullTable('vocabulary_kanji', userId, async (rows) => {
    await db.vocabularyKanji.bulkPut(
      rows.map((r) => remoteToVocabularyKanji(r)),
    );
  });
  await pullFullTable('vocabulary_confusions', userId, async (rows) => {
    await db.vocabularyConfusions.bulkPut(
      rows.map((r) => remoteToVocabularyConfusion(r)),
    );
  });
  await pullFullTable('card_issue_reports', userId, async (rows) => {
    await db.cardIssueReports.bulkPut(rows.map((r) => remoteToCardIssueReport(r)));
  });
  // grammarPatterns before sentenceGrammar/grammarRelationships — both
  // reference it, same parent-before-child ordering as kanji/vocabularyItems
  // above.
  await pullFullTable('grammar_patterns', userId, async (rows) => {
    await db.grammarPatterns.bulkPut(rows.map((r) => remoteToGrammarPattern(r)));
  });
  await pullFullTable('sentence_grammar', userId, async (rows) => {
    await db.sentenceGrammar.bulkPut(rows.map((r) => remoteToSentenceGrammar(r)));
  });
  await pullFullTable('grammar_relationships', userId, async (rows) => {
    await db.grammarRelationships.bulkPut(rows.map((r) => remoteToGrammarRelationship(r)));
  });
  await pullFullTable('planner_sessions', userId, async (rows) => {
    await db.plannerSessions.bulkPut(rows.map((r) => remoteToPlannerSession(r)));
  });
  await pullFullTable('sync_issue_reports', userId, async (rows) => {
    await db.syncIssueReports.bulkPut(rows.map((r) => remoteToSyncIssueReport(r)));
  });
  await pullFullTable('pitch_drill_attempts', userId, async (rows) => {
    await db.pitchDrillAttempts.bulkPut(rows.map((r) => remoteToPitchDrillAttempt(r)));
  });

  // Reference audio: metadata only (blob-less placeholders), gated on the
  // opt-in toggle. Blobs hydrate via hydrateMissingReferenceAudio below.
  // Only touched when the toggle is on — audio the user imported locally on
  // this device isn't "cloud data" and shouldn't be dropped by this path if
  // they never opted into audio sync.
  const audioSyncMeta = await ensureSyncMeta();
  if (audioSyncMeta.syncReferenceAudio) {
    await db.sentenceAudio.clear();
    await pullFullTable('reference_audio', userId, async (rows) => {
      await db.sentenceAudio.bulkPut(
        rows.map((r) => {
          const meta = remoteToReferenceAudio(r);
          return {
            id: meta.id,
            sentenceId: meta.sentenceId,
            sourceId: meta.sourceId,
            sourceSentenceId: meta.sourceSentenceId,
            sourceTitle: meta.sourceTitle,
            sourceUrl: meta.sourceUrl,
            mimeType: meta.mimeType,
            durationMs: meta.durationMs,
            startMs: meta.startMs,
            endMs: meta.endMs,
            blob: new Blob([], { type: meta.mimeType }),
            importedAt: meta.importedAt,
          };
        }),
      );
    });
    await hydrateMissingReferenceAudio();
  }

  const { data: maxEvent } = await supabase
    .from('sync_events')
    .select('id')
    .eq('owner_id', userId)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  await updateSyncMeta({
    userId,
    lastPullEventId: Number(maxEvent?.id ?? 0),
    deferredPullEventIds: [],
    migrationChoice: 'replace_cloud',
    lastSyncAt: new Date().toISOString(),
  });
}

async function pullFullTable(
  table: SyncEntity,
  userId: string,
  apply: (rows: Record<string, unknown>[]) => Promise<void>,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('owner_id', userId)
    .is('deleted_at', null);
  if (error) throw new Error(error.message);
  await apply((data ?? []) as Record<string, unknown>[]);
  for (const row of data ?? []) {
    const recordId =
      table === 'analyses' || table === 'inbox'
        ? String((row as { sentence_id: string }).sentence_id)
        : String((row as { id: string }).id);
    const version = Number((row as { version: number }).version ?? 1);
    await putRecordMeta({
      entity: table,
      recordId,
      version,
      syncedVersion: version,
      updatedAt: String(
        (row as { updated_at: string }).updated_at ?? new Date().toISOString(),
      ),
    });
  }
}
