import { createId } from '../lib/ids';
import { getDb } from '../db/database';
import { conflictContentsMatch } from './conflictDiff';
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

let lastLocalTimestampMs = 0;

/**
 * ISO timestamp for a queue row, strictly increasing within this session.
 * `listPendingMutations` orders by it, and `toISOString()` only has
 * millisecond resolution: rows queued in the same millisecond tied and came
 * back in random-id order, so "keeps queued order" was only true when the
 * clock happened to tick between enqueues (a flaky push-batching test in CI,
 * 2026-09-20). Bumping past the previous value costs at most a few ms of drift
 * during a burst.
 */
function nextLocalTimestamp(): string {
  lastLocalTimestampMs = Math.max(Date.now(), lastLocalTimestampMs + 1);
  return new Date(lastLocalTimestampMs).toISOString();
}

export async function enqueueMutation(input: {
  entity: SyncEntity;
  recordId: string;
  operation: SyncOperationType;
  expectedVersion: number | null;
  payload: unknown;
  /**
   * When coalescing over an existing queue row, replace its expectedVersion.
   * Default false: keep the original base so multi-edit offline bursts still
   * lock against the last synced cloud version (not a drifted local counter).
   */
  replaceExpectedVersion?: boolean;
}): Promise<SyncQueueItem> {
  const db = getDb();
  // Coalesce: replace any pending item for the same entity+record. The read and
  // the write run in one transaction so overlapping calls for the same record
  // (a create and an immediate edit, both fired without awaiting) serialize
  // instead of each seeing "nothing queued yet" and each inserting a row — which
  // is how a laptop ended up with every stuck link queued twice (2026-09-19).
  return db.transaction('rw', db.syncQueue, async () => {
    const existing = await db.syncQueue
      .where('[entity+recordId]')
      .equals([input.entity, input.recordId])
      .first();
    const expectedVersion =
      existing && !input.replaceExpectedVersion
        ? existing.expectedVersion
        : input.expectedVersion;
    const item: SyncQueueItem = {
      id: existing?.id ?? createId('opq'),
      entity: input.entity,
      recordId: input.recordId,
      operation: input.operation,
      expectedVersion,
      payload: input.payload,
      localTimestamp: nextLocalTimestamp(),
      retryCount: existing?.retryCount ?? 0,
      lastError: undefined,
    };
    await db.syncQueue.put(item);
    return item;
  });
}

/**
 * Collapses queue rows that share an (entity, recordId) into one — the newest
 * payload/operation under the oldest row's id and optimistic-lock base, the
 * same result coalescing would have produced. Heals queues that already hold
 * duplicates (from the enqueue race above, before it was fixed) so a remap or a
 * retry can't leave a stale twin behind. Returns how many rows were removed.
 */
export async function dedupeQueueRows(): Promise<number> {
  const db = getDb();
  return db.transaction('rw', db.syncQueue, async () => {
    const all = await db.syncQueue.orderBy('localTimestamp').toArray();
    const groups = new Map<string, SyncQueueItem[]>();
    for (const row of all) {
      const key = `${row.entity}:${row.recordId}`;
      const list = groups.get(key);
      if (list) list.push(row);
      else groups.set(key, [row]);
    }
    let removed = 0;
    for (const rows of groups.values()) {
      if (rows.length < 2) continue;
      const oldest = rows[0]!;
      const newest = rows[rows.length - 1]!;
      await db.syncQueue.put({
        ...newest,
        id: oldest.id,
        expectedVersion: oldest.expectedVersion,
        retryCount: Math.max(...rows.map((row) => row.retryCount)),
      });
      for (const extra of rows.slice(1)) await db.syncQueue.delete(extra.id);
      removed += rows.length - 1;
    }
    return removed;
  });
}

/** Last cloud version this device acknowledged for optimistic locking. */
export function syncedVersionOf(
  meta: SyncRecordMeta | undefined,
): number | null {
  if (!meta) return null;
  if (typeof meta.syncedVersion === 'number') return meta.syncedVersion;
  return meta.version;
}

export async function hasOpenConflict(
  entity: SyncEntity,
  recordId: string,
): Promise<boolean> {
  const open = await listOpenConflicts();
  return open.some((c) => c.entity === entity && c.recordId === recordId);
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

/**
 * Upserts on (entity, recordId) among *open* conflicts rather than always
 * inserting — several queued mutations for the same record can each hit
 * `version_conflict` in one push cycle (e.g. a few quick edits to one
 * sentence's analysis), and without this every one of them added its own
 * duplicate conflict card (34 rows for 10 actually-conflicting records in
 * one reported case, 2026-09-04). Updating in place also keeps the most
 * recent local edit as `localPayload` for "Keep local", instead of
 * whichever queued item happened to hit the conflict first.
 */
export async function addConflict(
  conflict: Omit<SyncConflict, 'id' | 'createdAt'> & {
    id?: string;
    createdAt?: string;
  },
): Promise<SyncConflict> {
  const existing = (await listOpenConflicts()).find(
    (c) => c.entity === conflict.entity && c.recordId === conflict.recordId,
  );
  const row: SyncConflict = {
    id: existing?.id ?? conflict.id ?? createId('conflict'),
    entity: conflict.entity,
    recordId: conflict.recordId,
    localPayload: conflict.localPayload,
    remotePayload: conflict.remotePayload,
    localVersion: conflict.localVersion,
    remoteVersion: conflict.remoteVersion,
    createdAt: existing?.createdAt ?? conflict.createdAt ?? new Date().toISOString(),
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

/**
 * Auto-resolves already-open conflicts whose frozen local/remote payloads no
 * longer show a real difference under the current `conflictDiff.ts`
 * normalization. `handlePushConflict` (engine.ts) only runs this check at
 * the moment a conflict is *created* — a conflict recorded before a diff
 * normalization fix landed (e.g. the `reviews` `createdAt` strip,
 * 2026-09-14) sits open forever otherwise, since nothing ever re-checks it
 * once ConflictPanel's diff view catches up and starts rendering it as "no
 * differences" (reported via Report sync issue, 2026-09-14 — "the diff
 * doesn't show a difference" on conflicts that predated the fix). Called
 * once per sync cycle; cheap, since it only touches already-open conflicts.
 */
export async function sweepNoopConflicts(): Promise<number> {
  const open = await listOpenConflicts();
  let swept = 0;
  for (const conflict of open) {
    if (
      conflictContentsMatch(
        conflict.localPayload,
        conflict.remotePayload,
        conflict.entity,
      )
    ) {
      await resolveConflictLocally(conflict.id, 'auto_noop');
      swept += 1;
    }
  }
  return swept;
}
