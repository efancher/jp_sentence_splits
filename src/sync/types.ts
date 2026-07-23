/** Synchronizable entity names matching Postgres table names. */
export type SyncEntity =
  | 'books'
  | 'sentences'
  | 'book_sentences'
  | 'analyses'
  | 'import_batches'
  | 'inbox'
  | 'reference_audio';

export type SyncOperationType = 'upsert' | 'delete';

export type SyncStatus =
  | 'local_only'
  | 'signed_out'
  | 'offline'
  | 'syncing'
  | 'synced'
  | 'pending'
  | 'error'
  | 'conflict';

export interface SyncQueueItem {
  id: string;
  entity: SyncEntity;
  recordId: string;
  operation: SyncOperationType;
  /** Remote version expected at push time (null for first insert). */
  expectedVersion: number | null;
  payload: unknown;
  localTimestamp: string;
  retryCount: number;
  lastError?: string;
}

export interface SyncRecordMeta {
  /** Composite key: `${entity}:${recordId}` */
  key: string;
  entity: SyncEntity;
  recordId: string;
  /**
   * Local generation counter (bumps on every local edit).
   * Not used for optimistic-lock checks against the cloud.
   */
  version: number;
  /**
   * Last cloud version this device successfully synced (push or pull).
   * Push optimistic locks use this value. Falls back to `version` for
   * records written before this field existed.
   */
  syncedVersion?: number;
  deletedAt?: string;
  updatedAt: string;
}

export interface SyncConflict {
  id: string;
  entity: SyncEntity;
  recordId: string;
  localPayload: unknown;
  remotePayload: unknown;
  localVersion: number;
  remoteVersion: number;
  createdAt: string;
  resolvedAt?: string;
  resolution?: 'keep_local' | 'keep_remote' | 'duplicate';
}

export interface SyncMetaState {
  id: 'sync';
  clientId: string;
  userId?: string;
  lastPullEventId: number;
  lastSyncAt?: string;
  lastError?: string;
  migrationChoice?: 'upload' | 'keep_local' | 'replace_cloud' | 'skipped';
  syncReferenceAudio: boolean;
  wifiOnlyAudioDownload: boolean;
}

export const SYNC_SCHEMA_VERSION = 1;

export const SYNCABLE_ENTITIES: readonly SyncEntity[] = [
  'books',
  'sentences',
  'book_sentences',
  'analyses',
  'import_batches',
  'inbox',
  'reference_audio',
] as const;
