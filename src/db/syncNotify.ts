import {
  requestSyncAfterCommit,
  trackLocalMutation,
  trackLocalMutationsInTransaction,
} from '../sync/track';
import type { SyncEntity } from '../sync/types';

/** Fire-and-forget sync enqueue after a local write. */
export function notifySync(
  entity: SyncEntity,
  recordId: string,
  payload: unknown,
  operation: 'upsert' | 'delete' = 'upsert',
): void {
  void trackLocalMutation({ entity, recordId, operation, payload }).catch(
    () => {
      // Sync failures must not break local edits.
    },
  );
}

export function notifySyncMany(
  items: Array<{
    entity: SyncEntity;
    recordId: string;
    payload: unknown;
    operation?: 'upsert' | 'delete';
  }>,
): void {
  for (const item of items) {
    notifySync(item.entity, item.recordId, item.payload, item.operation ?? 'upsert');
  }
}

type SinkOp = {
  entity: SyncEntity;
  recordId: string;
  payload: unknown;
  operation?: 'upsert' | 'delete';
};

/**
 * Last statement of a multi-row local transaction: queue its sync ops in the
 * same transaction as the data writes (the scope must include `syncMeta`,
 * `syncQueue` and `syncRecordMeta`). Returns whether that settled it; if not,
 * pass the result to `finishSinkAfterCommit`, which falls back to the old
 * post-commit enqueue.
 */
export async function trackSinkInTransaction(sink: SinkOp[]): Promise<boolean> {
  if (!sink.length) return true;
  return trackLocalMutationsInTransaction(sink);
}

/** After the transaction commits: nudge the engine, or enqueue the old way. */
export function finishSinkAfterCommit(sink: SinkOp[], tracked: boolean): void {
  if (!tracked) notifySyncMany(sink);
  else if (sink.length) requestSyncAfterCommit();
}
