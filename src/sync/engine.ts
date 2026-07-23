import { getDb } from '../db/database';
import {
  bumpQueueRetry,
  ensureSyncMeta,
  listPendingMutations,
  putRecordMeta,
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
  remoteToImportBatch,
  remoteToInbox,
  remoteToReferenceAudio,
  remoteToSentence,
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
      await pushMutations();
      await pullChanges();
      await updateSyncMeta({
        lastSyncAt: new Date().toISOString(),
        lastError: undefined,
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

async function pushMutations(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return;

  const pending = await listPendingMutations();
  syncLog('debug', `Pushing ${pending.length} mutations`);

  for (const item of pending) {
    try {
      await pushOne(item, userId);
      await removeQueueItem(item.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'version_conflict') {
        await handlePushConflict(item, userId);
        await removeQueueItem(item.id);
        continue;
      }
      syncLog('warn', 'Push failed', 'PUSH_FAIL', {
        entity: item.entity,
        recordId: item.recordId,
        message,
      });
      await bumpQueueRetry(item.id, message);
    }
  }
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
    if (error) throw new Error(error.message);
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

    for (const event of events) {
      await applyRemoteEvent(
        event.entity as SyncEntity,
        String(event.record_id),
        String(event.op),
        Number(event.version),
      );
      cursor = Number(event.id);
    }
    await updateSyncMeta({ lastPullEventId: cursor });
    keepGoing = events.length === PULL_PAGE_SIZE;
  }
}

/** Apply a remote sync_events row. Exported for unit tests. */
export async function applyRemoteEvent(
  entity: SyncEntity,
  recordId: string,
  op: string,
  version: number,
): Promise<void> {
  const pending = await listPendingMutations();
  const hasLocalPending = pending.some(
    (p) => p.entity === entity && p.recordId === recordId,
  );
  if (hasLocalPending) {
    // Leave for push/conflict handling.
    return;
  }

  if (await hasOpenConflict(entity, recordId)) {
    // Keep local data until the user resolves Keep local / Keep remote.
    return;
  }

  const localMeta = await getRecordMeta(entity, recordId);
  if (localMeta && localMeta.version >= version && op !== 'delete') {
    return;
  }

  const supabase = getSupabase();
  if (!supabase) return;
  const idCol = idColumnForEntity(entity);
  const { data: remote, error } = await supabase
    .from(entity)
    .select('*')
    .eq(idCol, recordId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (!remote || remote.deleted_at) {
    await applyRemoteDelete(entity, recordId, version);
    return;
  }

  await applyRemoteUpsert(entity, remote as Record<string, unknown>, version);
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
