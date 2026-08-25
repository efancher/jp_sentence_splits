import type { EntityTable } from 'dexie';

import { getDb } from '../db/database';
import {
  bumpQueueRetry,
  ensureSyncMeta,
  listPendingMutations,
  putRecordMeta,
  recordMetaKey,
  removeQueueItem,
  addConflict,
  updateSyncMeta,
  getRecordMeta,
  hasOpenConflict,
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
  remoteToPlannerSession,
  remoteToReferenceAudio,
  remoteToReview,
  remoteToSentence,
  remoteToSentenceGrammar,
  remoteToSentenceVocabulary,
  remoteToStudyItem,
  remoteToVocabularyConfusion,
  remoteToVocabularyItem,
  remoteToVocabularyKanji,
  toRemoteRow,
} from './mappers';
import { getSupabase } from './supabaseClient';
import { syncLog } from './logger';
import type { SyncEntity, SyncQueueItem } from './types';

const PULL_PAGE_SIZE = 100;

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

/** Returns a short failure summary when any queue item could not be pushed. */
async function pushMutations(): Promise<string | undefined> {
  const supabase = getSupabase();
  if (!supabase) return undefined;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return undefined;

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
        (item.entity === 'kanji' || item.entity === 'vocabulary_items') &&
        (await adoptRemoteDuplicate(item.entity, item.recordId, row))
      ) {
        return;
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

type DedupEntity = 'kanji' | 'vocabulary_items';

/**
 * `kanji`/`vocabulary_items` are get-or-create, deduped locally by natural
 * key (character / expression+reading — see repository.ts's ensureKanji/
 * ensureVocabularyItem). If a device's local cache missed a row that
 * already exists remotely (e.g. a stale cursor from before a bulk import,
 * docs/STATUS.md), get-or-create mints a duplicate with a fresh local id,
 * and its insert hits the remote natural-key unique index (23505) instead
 * of the id-based version_conflict path. Recover by adopting the existing
 * remote row's id in place of retrying an insert that can never succeed.
 */
async function adoptRemoteDuplicate(
  entity: DedupEntity,
  localId: string,
  row: Record<string, unknown>,
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const query = supabase.from(entity).select('*').is('deleted_at', null);
  const { data: remote, error } =
    entity === 'kanji'
      ? await query.eq('character', row.character as string).maybeSingle()
      : await query
          .eq('expression', row.expression as string)
          .eq('reading', row.reading as string)
          .maybeSingle();
  if (error || !remote) return false;

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
    [db.kanji, db.vocabularyItems, db.vocabularyKanji, db.sentenceVocabulary, db.syncQueue, db.syncRecordMeta],
    async () => {
      if (entity === 'kanji') {
        await db.kanji.delete(oldId);
        await db.kanji.put(remoteToKanji(remoteRow));
      } else {
        await db.vocabularyItems.delete(oldId);
        await db.vocabularyItems.put(remoteToVocabularyItem(remoteRow));
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
      } else {
        await remapLinkReferences(db.vocabularyKanji, 'vocabularyItemId', oldId, newId, 'vocabulary_kanji');
        await remapLinkReferences(db.sentenceVocabulary, 'vocabularyItemId', oldId, newId, 'sentence_vocabulary');
      }
    },
  );
}

/** Repoints every local link row's foreign key (and any queued push for it) from `oldId` to `newId`. */
async function remapLinkReferences<T extends { id: string }, F extends keyof T & string>(
  table: EntityTable<T, 'id'>,
  fkField: F,
  oldId: string,
  newId: string,
  syncEntity: SyncEntity,
): Promise<void> {
  const db = getDb();
  const links = await table.where(fkField).equals(oldId).toArray();
  for (const link of links) {
    const updated: T = { ...link, [fkField]: newId };
    await table.put(updated);
    const queueItem = await db.syncQueue
      .where('[entity+recordId]')
      .equals([syncEntity, link.id])
      .first();
    if (queueItem) {
      await db.syncQueue.put({
        ...queueItem,
        payload: updated,
        lastError: undefined,
      });
    }
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

    await applyRemoteEventsBatch(events);
    cursor = Number(events[events.length - 1]!.id);

    await updateSyncMeta({ lastPullEventId: cursor });
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
    return false;
  }

  return true;
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
  await applyRemoteUpsert(entity, remote, version);
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
): Promise<void> {
  const pending = await listPendingMutations();

  type PendingFetch = { entity: SyncEntity; recordId: string; version: number };
  const toFetch: PendingFetch[] = [];
  for (const event of events) {
    const entity = event.entity as SyncEntity;
    const recordId = String(event.record_id);
    const op = String(event.op);
    const version = Number(event.version);
    if (await shouldApplyRemoteEvent(entity, recordId, op, version, pending)) {
      toFetch.push({ entity, recordId, version });
    }
  }
  if (!toFetch.length) return;

  const supabase = getSupabase();
  if (!supabase) return;

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

async function applyRemoteUpsert(
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
      // Metadata only — blobs download on demand.
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
      }
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
