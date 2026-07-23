import { createId } from '../lib/ids';
import { getDb } from '../db/database';
import type {
  SyncConflict,
  SyncEntity,
  SyncMetaState,
  SyncOperationType,
  SyncQueueItem,
  SyncRecordMeta,
} from './types';

const META_ID = 'sync' as const;

export async function readSyncMeta(): Promise<SyncMetaState> {
  const existing = await getDb().syncMeta.get(META_ID);
  if (existing) return existing;
  return {
    id: META_ID,
    clientId: 'pending',
    lastPullEventId: 0,
    syncReferenceAudio: false,
    wifiOnlyAudioDownload: true,
  };
}

export async function ensureSyncMeta(): Promise<SyncMetaState> {
  const db = getDb();
  const existing = await db.syncMeta.get(META_ID);
  if (existing) return existing;
  const initial: SyncMetaState = {
    id: META_ID,
    clientId: createId('client'),
    lastPullEventId: 0,
    syncReferenceAudio: false,
    wifiOnlyAudioDownload: true,
  };
  await db.syncMeta.put(initial);
  return initial;
}

export async function updateSyncMeta(
  patch: Partial<Omit<SyncMetaState, 'id'>>,
): Promise<SyncMetaState> {
  const current = await ensureSyncMeta();
  const next = { ...current, ...patch, id: META_ID };
  await getDb().syncMeta.put(next);
  return next;
}

export function recordMetaKey(entity: SyncEntity, recordId: string): string {
  return `${entity}:${recordId}`;
}

export async function getRecordMeta(
  entity: SyncEntity,
  recordId: string,
): Promise<SyncRecordMeta | undefined> {
  return getDb().syncRecordMeta.get(recordMetaKey(entity, recordId));
}

export async function putRecordMeta(
  meta: Omit<SyncRecordMeta, 'key'> & { key?: string },
): Promise<void> {
  const key = meta.key ?? recordMetaKey(meta.entity, meta.recordId);
  await getDb().syncRecordMeta.put({ ...meta, key });
}

export async function enqueueMutation(input: {
  entity: SyncEntity;
  recordId: string;
  operation: SyncOperationType;
  expectedVersion: number | null;
  payload: unknown;
}): Promise<SyncQueueItem> {
  const db = getDb();
  // Coalesce: replace any pending item for the same entity+record.
  const existing = await db.syncQueue
    .where('[entity+recordId]')
    .equals([input.entity, input.recordId])
    .first();
  const item: SyncQueueItem = {
    id: existing?.id ?? createId('opq'),
    entity: input.entity,
    recordId: input.recordId,
    operation: input.operation,
    expectedVersion: input.expectedVersion,
    payload: input.payload,
    localTimestamp: new Date().toISOString(),
    retryCount: existing?.retryCount ?? 0,
    lastError: undefined,
  };
  await db.syncQueue.put(item);
  return item;
}

export async function listPendingMutations(): Promise<SyncQueueItem[]> {
  return getDb().syncQueue.orderBy('localTimestamp').toArray();
}

export async function removeQueueItem(id: string): Promise<void> {
  await getDb().syncQueue.delete(id);
}

export async function bumpQueueRetry(
  id: string,
  error: string,
): Promise<void> {
  const db = getDb();
  const item = await db.syncQueue.get(id);
  if (!item) return;
  await db.syncQueue.put({
    ...item,
    retryCount: item.retryCount + 1,
    lastError: error,
  });
}

export async function clearQueue(): Promise<void> {
  await getDb().syncQueue.clear();
}

export async function addConflict(
  conflict: Omit<SyncConflict, 'id' | 'createdAt'> & {
    id?: string;
    createdAt?: string;
  },
): Promise<SyncConflict> {
  const row: SyncConflict = {
    id: conflict.id ?? createId('conflict'),
    entity: conflict.entity,
    recordId: conflict.recordId,
    localPayload: conflict.localPayload,
    remotePayload: conflict.remotePayload,
    localVersion: conflict.localVersion,
    remoteVersion: conflict.remoteVersion,
    createdAt: conflict.createdAt ?? new Date().toISOString(),
    resolvedAt: conflict.resolvedAt,
    resolution: conflict.resolution,
  };
  await getDb().syncConflicts.put(row);
  return row;
}

export async function listOpenConflicts(): Promise<SyncConflict[]> {
  const all = await getDb().syncConflicts.toArray();
  return all.filter((c) => !c.resolvedAt);
}

export async function resolveConflictLocally(
  conflictId: string,
  resolution: SyncConflict['resolution'],
): Promise<void> {
  const db = getDb();
  const existing = await db.syncConflicts.get(conflictId);
  if (!existing) return;
  await db.syncConflicts.put({
    ...existing,
    resolution,
    resolvedAt: new Date().toISOString(),
  });
}

export async function pendingCount(): Promise<number> {
  return getDb().syncQueue.count();
}

export async function openConflictCount(): Promise<number> {
  const open = await listOpenConflicts();
  return open.length;
}
