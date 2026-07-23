import { trackLocalMutation } from '../sync/track';
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
