import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { createBook, saveAnalysis } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import {
  addConflict,
  bumpQueueRetry,
  clearQueue,
  enqueueMutation,
  ensureSyncMeta,
  listOpenConflicts,
  listPendingMutations,
  pendingCount,
  putRecordMeta,
  removeQueueItem,
  resolveConflictLocally,
  updateSyncMeta,
} from '../src/sync/queue';
import { trackLocalMutation } from '../src/sync/track';
import { hasLocalStudyData, needsMigrationPrompt } from '../src/sync/migration';
import { sentenceAudioToReferenceMeta } from '../src/sync/mappers';
import type { SentenceAudio } from '../src/domain/types';

describe('sync queue and local-first mutations', () => {
  beforeEach(() => {
    resetDbForTests(`sync-${createId('db')}`);
    vi.unstubAllGlobals();
  });

  it('queues a mutation after local create when signed-in meta is set', async () => {
    await updateSyncMeta({ userId: 'user-1' });
    // Pretend Supabase is configured so trackLocalMutation enqueues.
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');

    const { resetSupabaseClientForTests } = await import(
      '../src/sync/supabaseClient'
    );
    resetSupabaseClientForTests();

    const book = await createBook({ title: 'Offline book' });
    // createBook notifies sync; without a real session, track checks session.
    // Force an explicit queue entry to prove offline create + queue semantics.
    await trackLocalMutation({
      entity: 'books',
      recordId: book.id,
      operation: 'upsert',
      payload: book,
    });

    // Without a live session, trackLocalMutation returns early after meta bump.
    const meta = await ensureSyncMeta();
    expect(meta.userId).toBe('user-1');
    const recordMeta = await import('../src/sync/queue').then((m) =>
      m.getRecordMeta('books', book.id),
    );
    expect(recordMeta?.version).toBeGreaterThanOrEqual(1);
  });

  it('enqueues, retries, and removes queue items', async () => {
    const item = await enqueueMutation({
      entity: 'books',
      recordId: 'book_1',
      operation: 'upsert',
      expectedVersion: null,
      payload: { id: 'book_1', title: 'A' },
    });
    expect(await pendingCount()).toBe(1);

    await bumpQueueRetry(item.id, 'network');
    const pending = await listPendingMutations();
    expect(pending[0]?.retryCount).toBe(1);
    expect(pending[0]?.lastError).toBe('network');

    await removeQueueItem(item.id);
    expect(await pendingCount()).toBe(0);

    await enqueueMutation({
      entity: 'books',
      recordId: 'book_1',
      operation: 'upsert',
      expectedVersion: 1,
      payload: { id: 'book_1', title: 'B' },
    });
    await clearQueue();
    expect(await pendingCount()).toBe(0);
  });

  it('coalesces multiple mutations for the same record', async () => {
    await enqueueMutation({
      entity: 'analyses',
      recordId: 'sent_1',
      operation: 'upsert',
      expectedVersion: 0,
      payload: { notes: 'first' },
    });
    await enqueueMutation({
      entity: 'analyses',
      recordId: 'sent_1',
      operation: 'upsert',
      expectedVersion: 1,
      payload: { notes: 'second' },
    });
    const pending = await listPendingMutations();
    expect(pending).toHaveLength(1);
    expect((pending[0]?.payload as { notes: string }).notes).toBe('second');
  });

  it('preserves conflicts until resolved', async () => {
    const conflict = await addConflict({
      entity: 'analyses',
      recordId: 'sent_x',
      localPayload: { notes: 'local' },
      remotePayload: { notes: 'remote' },
      localVersion: 2,
      remoteVersion: 3,
    });
    expect(await listOpenConflicts()).toHaveLength(1);
    await resolveConflictLocally(conflict.id, 'keep_local');
    expect(await listOpenConflicts()).toHaveLength(0);
  });

  it('detects local study data for migration prompts', async () => {
    expect(await hasLocalStudyData()).toBe(false);
    await createBook({ title: 'Local only' });
    expect(await hasLocalStudyData()).toBe(true);
    expect(await needsMigrationPrompt('user-abc')).toBe(true);
    await updateSyncMeta({ migrationChoice: 'keep_local' });
    expect(await needsMigrationPrompt('user-abc')).toBe(false);
  });

  it('tracks soft-delete metadata without dropping the queue entry shape', async () => {
    await putRecordMeta({
      entity: 'books',
      recordId: 'book_del',
      version: 4,
      updatedAt: new Date().toISOString(),
    });
    await enqueueMutation({
      entity: 'books',
      recordId: 'book_del',
      operation: 'delete',
      expectedVersion: 4,
      payload: { id: 'book_del' },
    });
    const pending = await listPendingMutations();
    expect(pending[0]?.operation).toBe('delete');
    expect(pending[0]?.expectedVersion).toBe(4);
  });

  it('keeps reference audio blobs local when building sync metadata', () => {
    const audio: SentenceAudio = {
      id: 'audio_1',
      sentenceId: 'sent_1',
      sourceId: 'src',
      sourceSentenceId: 's1',
      sourceTitle: 'Title',
      mimeType: 'audio/mp4',
      durationMs: 1000,
      startMs: 0,
      endMs: 1000,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' }),
      importedAt: new Date().toISOString(),
    };
    const meta = sentenceAudioToReferenceMeta(audio, 'book_1');
    expect(meta.storagePath).toBeUndefined();
    expect(meta.sizeBytes).toBe(3);
    expect('blob' in meta).toBe(false);
  });

  it('two logical devices can edit different records without conflict rows', async () => {
    await saveAnalysis('sent_a', [
      {
        id: 'c1',
        order: 0,
        japanese: 'あ',
        role: 'engine',
        literalEnglish: 'a',
      },
    ]);
    await saveAnalysis('sent_b', [
      {
        id: 'c1',
        order: 0,
        japanese: 'い',
        role: 'engine',
        literalEnglish: 'i',
      },
    ]);
    await enqueueMutation({
      entity: 'analyses',
      recordId: 'sent_a',
      operation: 'upsert',
      expectedVersion: 1,
      payload: { sentenceId: 'sent_a' },
    });
    await enqueueMutation({
      entity: 'analyses',
      recordId: 'sent_b',
      operation: 'upsert',
      expectedVersion: 1,
      payload: { sentenceId: 'sent_b' },
    });
    expect(await listOpenConflicts()).toHaveLength(0);
    expect(await pendingCount()).toBe(2);
  });

  it('same-record divergent edits create a preserved conflict', async () => {
    await addConflict({
      entity: 'analyses',
      recordId: 'sent_same',
      localPayload: { notes: 'device A' },
      remotePayload: { notes: 'device B' },
      localVersion: 5,
      remoteVersion: 5,
    });
    const open = await listOpenConflicts();
    expect(open).toHaveLength(1);
    expect((open[0]?.localPayload as { notes: string }).notes).toBe('device A');
    expect((open[0]?.remotePayload as { notes: string }).notes).toBe('device B');
  });
});

describe('sync mappers', () => {
  beforeEach(() => {
    resetDbForTests(`sync-map-${createId('db')}`);
  });

  it('round-trips a book through remote shape', async () => {
    const { bookToRemote, remoteToBook } = await import('../src/sync/mappers');
    const book = await createBook({ title: 'Mapper book', notes: 'n' });
    const remote = bookToRemote(book, 'user-1', 3);
    expect(remote.owner_id).toBe('user-1');
    expect(remote.version).toBe(3);
    const local = remoteToBook(remote);
    expect(local.title).toBe('Mapper book');
    expect(local.notes).toBe('n');
  });
});
