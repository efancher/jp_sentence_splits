import { getDb } from '../db/database';
import {
  enqueueMutation,
  getRecordMeta,
  putRecordMeta,
  ensureSyncMeta,
  syncedVersionOf,
} from './queue';
import { getSupabase, isSupabaseConfigured } from './supabaseClient';
import type { SyncEntity, SyncOperationType } from './types';
import { syncLog } from './logger';

let syncRequested: (() => void) | null = null;

/** Register a callback the repository uses after enqueueing (set by SyncProvider). */
export function setSyncRequestHandler(handler: (() => void) | null): void {
  syncRequested = handler;
}

function requestSyncSoon(): void {
  syncRequested?.();
}

export async function isSyncActive(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const supabase = getSupabase();
  if (!supabase) return false;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return Boolean(session?.user);
}

/**
 * After a successful local Dexie write, record sync metadata and queue a push.
 * No-ops when the user is signed out (still updates local version meta for later upload).
 */
export async function trackLocalMutation(input: {
  entity: SyncEntity;
  recordId: string;
  operation: SyncOperationType;
  payload: unknown;
}): Promise<void> {
  const now = new Date().toISOString();
  // Read-modify-write in one transaction so an in-flight push's version ack
  // can't be overwritten with the stale syncedVersion read here.
  const syncedVersion = await getDb().transaction(
    'rw',
    getDb().syncRecordMeta,
    async () => {
      const existing = await getRecordMeta(input.entity, input.recordId);
      const synced = syncedVersionOf(existing);
      await putRecordMeta({
        entity: input.entity,
        recordId: input.recordId,
        version: (existing?.version ?? 0) + 1,
        // Keep the last acknowledged cloud version for optimistic locks.
        syncedVersion: synced ?? 0,
        updatedAt: now,
        deletedAt: input.operation === 'delete' ? now : undefined,
      });
      return synced;
    },
  );

  const meta = await ensureSyncMeta();
  const supabase = getSupabase();
  const signedIn = Boolean(meta.userId) || Boolean(
    supabase && (await supabase.auth.getSession()).data.session?.user,
  );

  if (!signedIn || !isSupabaseConfigured()) {
    return;
  }

  if (input.entity === 'reference_audio' && !meta.syncReferenceAudio) {
    syncLog('debug', 'Skipping reference_audio queue (sync disabled)');
    return;
  }

  await enqueueMutation({
    entity: input.entity,
    recordId: input.recordId,
    operation: input.operation,
    // Lock against last synced cloud version, not the bumped local counter.
    expectedVersion: syncedVersion,
    payload: input.payload,
  });
  requestSyncSoon();
}

/**
 * Same bookkeeping as `trackLocalMutation`, but run INSIDE the caller's open
 * Dexie transaction so the data write, its record-meta bump and its queue row
 * commit (or don't) together. Doing these as separate post-commit steps let an
 * iOS suspend strand a committed write with no queue row — the cause of orphan
 * children whose sentence never reached the server.
 *
 * The caller's transaction must include `syncMeta`, `syncQueue` and
 * `syncRecordMeta`, and nothing in here may await non-IndexedDB work (the
 * transaction would auto-commit), so signed-in state comes from the stored
 * `userId` only. Returns false when that can't settle the question (Supabase is
 * configured but no stored user): the caller should then fall back to the
 * post-commit `notifySyncMany`.
 */
export async function trackLocalMutationsInTransaction(
  items: Array<{
    entity: SyncEntity;
    recordId: string;
    payload: unknown;
    operation?: SyncOperationType;
  }>,
): Promise<boolean> {
  const meta = await ensureSyncMeta();
  const configured = isSupabaseConfigured();
  if (configured && !meta.userId) return false;

  const now = new Date().toISOString();
  for (const item of items) {
    const operation = item.operation ?? 'upsert';
    const existing = await getRecordMeta(item.entity, item.recordId);
    const synced = syncedVersionOf(existing);
    await putRecordMeta({
      entity: item.entity,
      recordId: item.recordId,
      version: (existing?.version ?? 0) + 1,
      syncedVersion: synced ?? 0,
      updatedAt: now,
      deletedAt: operation === 'delete' ? now : undefined,
    });
    if (!configured) continue;
    if (item.entity === 'reference_audio' && !meta.syncReferenceAudio) continue;
    await enqueueMutation({
      entity: item.entity,
      recordId: item.recordId,
      operation,
      expectedVersion: synced,
      payload: item.payload,
    });
  }
  return true;
}

/** Ask the sync engine for a cycle after a transactional enqueue committed. */
export function requestSyncAfterCommit(): void {
  requestSyncSoon();
}

/** Soft-delete helper used when sync is active; otherwise caller hard-deletes. */
export async function softDeleteLocal(
  entity: SyncEntity,
  recordId: string,
  hardDelete: () => Promise<void>,
): Promise<void> {
  const active = await isSyncActive();
  if (!active) {
    await hardDelete();
    await getDb().syncRecordMeta.delete(`${entity}:${recordId}`);
    return;
  }
  await trackLocalMutation({
    entity,
    recordId,
    operation: 'delete',
    payload: { id: recordId },
  });
  await hardDelete();
}
