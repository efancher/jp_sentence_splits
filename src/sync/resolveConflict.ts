import { getDb } from '../db/database';
import { createId } from '../lib/ids';
import {
  enqueueMutation,
  putRecordMeta,
  resolveConflictLocally,
} from './queue';
import {
  remoteToAnalysis,
  remoteToBook,
  remoteToBookSentence,
  remoteToImportBatch,
  remoteToInbox,
  remoteToSentence,
} from './mappers';
import type { SyncConflict, SyncEntity } from './types';

export type ConflictResolution = 'keep_local' | 'keep_remote' | 'duplicate';

async function applyPayload(
  entity: SyncEntity,
  payload: unknown,
  asRemoteRow: boolean,
): Promise<void> {
  const db = getDb();
  const row = payload as Record<string, unknown>;
  switch (entity) {
    case 'books':
      await db.books.put(asRemoteRow ? remoteToBook(row) : (payload as never));
      break;
    case 'sentences':
      await db.sentences.put(
        asRemoteRow ? remoteToSentence(row) : (payload as never),
      );
      break;
    case 'book_sentences':
      await db.bookSentences.put(
        asRemoteRow ? remoteToBookSentence(row) : (payload as never),
      );
      break;
    case 'analyses':
      await db.analyses.put(
        asRemoteRow ? remoteToAnalysis(row) : (payload as never),
      );
      break;
    case 'import_batches':
      await db.importBatches.put(
        asRemoteRow ? remoteToImportBatch(row) : (payload as never),
      );
      break;
    case 'inbox':
      await db.inbox.put(asRemoteRow ? remoteToInbox(row) : (payload as never));
      break;
    default:
      break;
  }
}

/** Apply one conflict resolution locally (does not sync). */
export async function applyConflictResolution(
  conflict: SyncConflict,
  resolution: ConflictResolution,
): Promise<void> {
  if (resolution === 'keep_local') {
    await applyPayload(conflict.entity, conflict.localPayload, false);
    await putRecordMeta({
      entity: conflict.entity,
      recordId: conflict.recordId,
      version: conflict.remoteVersion,
      updatedAt: new Date().toISOString(),
    });
    await enqueueMutation({
      entity: conflict.entity,
      recordId: conflict.recordId,
      operation: 'upsert',
      expectedVersion: conflict.remoteVersion,
      payload: conflict.localPayload,
    });
  } else if (resolution === 'keep_remote') {
    await applyPayload(conflict.entity, conflict.remotePayload, true);
    await putRecordMeta({
      entity: conflict.entity,
      recordId: conflict.recordId,
      version: conflict.remoteVersion,
      updatedAt: new Date().toISOString(),
    });
  } else if (
    resolution === 'duplicate' &&
    (conflict.entity === 'books' || conflict.entity === 'sentences')
  ) {
    await applyPayload(conflict.entity, conflict.remotePayload, true);
    const local = conflict.localPayload as { id: string; title?: string };
    const copy = {
      ...(conflict.localPayload as object),
      id: createId(conflict.entity === 'books' ? 'book' : 'sent'),
      title:
        conflict.entity === 'books'
          ? `${local.title ?? 'Book'} (local copy)`
          : undefined,
    };
    await applyPayload(conflict.entity, copy, false);
    await enqueueMutation({
      entity: conflict.entity,
      recordId: (copy as { id: string }).id,
      operation: 'upsert',
      expectedVersion: null,
      payload: copy,
    });
  }
  await resolveConflictLocally(conflict.id, resolution);
}

/** Resolve every open conflict the same way (keep_local or keep_remote only). */
export async function applyBulkConflictResolution(
  conflicts: readonly SyncConflict[],
  resolution: 'keep_local' | 'keep_remote',
): Promise<number> {
  let resolved = 0;
  for (const conflict of conflicts) {
    await applyConflictResolution(conflict, resolution);
    resolved += 1;
  }
  return resolved;
}
