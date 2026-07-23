import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';

import { getDb } from '../db/database';
import { createId } from '../lib/ids';
import {
  listOpenConflicts,
  resolveConflictLocally,
  enqueueMutation,
  putRecordMeta,
} from '../sync/queue';
import {
  remoteToAnalysis,
  remoteToBook,
  remoteToBookSentence,
  remoteToImportBatch,
  remoteToInbox,
  remoteToSentence,
} from '../sync/mappers';
import type { SyncConflict, SyncEntity } from '../sync/types';
import { useSync } from '../sync/SyncProvider';

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

function summarize(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2).slice(0, 1200);
  } catch {
    return String(payload);
  }
}

export function ConflictPanel() {
  const sync = useSync();
  const conflicts = useLiveQuery(() => listOpenConflicts(), []) ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!conflicts.length) return null;

  async function resolve(
    conflict: SyncConflict,
    resolution: 'keep_local' | 'keep_remote' | 'duplicate',
  ): Promise<void> {
    setBusyId(conflict.id);
    try {
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
      await sync.syncNow();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel stack">
      <h3 style={{ margin: 0 }}>Conflicts need attention</h3>
      <p className="muted" style={{ margin: 0 }}>
        The same record changed on this device and in the cloud. Nothing was
        overwritten automatically.
      </p>
      {conflicts.map((conflict) => (
        <div key={conflict.id} className="stack conflict-card">
          <div>
            <strong>
              {conflict.entity} · {conflict.recordId}
            </strong>
            <div className="muted">
              local v{conflict.localVersion} vs remote v{conflict.remoteVersion}
            </div>
          </div>
          <details>
            <summary>Local version</summary>
            <pre className="conflict-pre">{summarize(conflict.localPayload)}</pre>
          </details>
          <details>
            <summary>Remote version</summary>
            <pre className="conflict-pre">{summarize(conflict.remotePayload)}</pre>
          </details>
          <div className="row">
            <button
              type="button"
              disabled={busyId === conflict.id}
              onClick={() => void resolve(conflict, 'keep_local')}
            >
              Keep local
            </button>
            <button
              type="button"
              disabled={busyId === conflict.id}
              onClick={() => void resolve(conflict, 'keep_remote')}
            >
              Keep remote
            </button>
            {(conflict.entity === 'books' || conflict.entity === 'sentences') && (
              <button
                type="button"
                disabled={busyId === conflict.id}
                onClick={() => void resolve(conflict, 'duplicate')}
              >
                Keep both (duplicate local)
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
