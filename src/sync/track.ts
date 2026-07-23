import { getDb } from '../db/database';
import {
  enqueueMutation,
  getRecordMeta,
  putRecordMeta,
  ensureSyncMeta,
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
  const existing = await getRecordMeta(input.entity, input.recordId);
  const nextVersion = (existing?.version ?? 0) + 1;
  const now = new Date().toISOString();
  await putRecordMeta({
    entity: input.entity,
    recordId: input.recordId,
    version: nextVersion,
    updatedAt: now,
    deletedAt: input.operation === 'delete' ? now : undefined,
  });

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
    expectedVersion: existing?.version ?? null,
    payload: input.payload,
  });
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
