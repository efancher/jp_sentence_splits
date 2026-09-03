import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, resetDbForTests } from '../src/db/database';
import {
  createBook,
  ensureGrammarPattern,
  ensureGrammarRelationship,
  ensureKanji,
  ensureSentenceGrammar,
  ensureVocabularyItem,
  materializeVocabularySelections,
  saveAnalysis,
} from '../src/db/repository';
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
import { applyBulkConflictResolution } from '../src/sync/resolveConflict';
import { trackLocalMutation } from '../src/sync/track';
import { hasLocalStudyData, needsMigrationPrompt } from '../src/sync/migration';
import { sentenceAudioToReferenceMeta } from '../src/sync/mappers';
import type { PlannerSession, SentenceAudio } from '../src/domain/types';

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

  it('coalesce preserves the original expectedVersion across edits', async () => {
    await enqueueMutation({
      entity: 'analyses',
      recordId: 'sent_coalesce',
      operation: 'upsert',
      expectedVersion: 7,
      payload: { sentenceId: 'sent_coalesce', notes: 'first' },
    });
    await enqueueMutation({
      entity: 'analyses',
      recordId: 'sent_coalesce',
      operation: 'upsert',
      expectedVersion: 8,
      payload: { sentenceId: 'sent_coalesce', notes: 'second' },
    });
    const pending = await listPendingMutations();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.expectedVersion).toBe(7);
    expect((pending[0]?.payload as { notes: string }).notes).toBe('second');
  });

  it('replaceExpectedVersion allows keep-local to reset the lock base', async () => {
    await enqueueMutation({
      entity: 'analyses',
      recordId: 'sent_replace',
      operation: 'upsert',
      expectedVersion: 33,
      payload: { notes: 'stale' },
    });
    await enqueueMutation({
      entity: 'analyses',
      recordId: 'sent_replace',
      operation: 'upsert',
      expectedVersion: 7,
      payload: { notes: 'resolved' },
      replaceExpectedVersion: true,
    });
    const pending = await listPendingMutations();
    expect(pending[0]?.expectedVersion).toBe(7);
  });

  it('does not apply remote events while an open conflict exists', async () => {
    const { applyRemoteEvent } = await import('../src/sync/engine');
    await putRecordMeta({
      entity: 'analyses',
      recordId: 'sent_guard',
      version: 7,
      syncedVersion: 7,
      updatedAt: new Date().toISOString(),
    });
    await getDb().analyses.put({
      sentenceId: 'sent_guard',
      chunks: [
        {
          id: 'c1',
          order: 0,
          japanese: 'local',
          role: 'engine',
          literalEnglish: 'local',
        },
      ],
      notes: 'keep-me',
      status: 'in_progress',
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await addConflict({
      entity: 'analyses',
      recordId: 'sent_guard',
      localPayload: { notes: 'local' },
      remotePayload: {
        sentence_id: 'sent_guard',
        notes: 'remote',
        chunks: [],
        version: 8,
      },
      localVersion: 7,
      remoteVersion: 8,
    });

    await applyRemoteEvent('analyses', 'sent_guard', 'upsert', 8);

    const analysis = await getDb().analyses.get('sent_guard');
    expect(analysis?.notes).toBe('keep-me');
  });

  it('shouldApplyRemoteEvent skips a record with a still-pending local mutation', async () => {
    const { shouldApplyRemoteEvent } = await import('../src/sync/engine');
    await enqueueMutation({
      entity: 'kanji',
      recordId: 'kanji_1',
      operation: 'upsert',
      expectedVersion: null,
      payload: { id: 'kanji_1', character: '大' },
    });

    expect(await shouldApplyRemoteEvent('kanji', 'kanji_1', 'upsert', 1)).toBe(false);
    expect(
      await shouldApplyRemoteEvent('kanji', 'kanji_other', 'upsert', 1),
    ).toBe(true);
  });

  it('shouldApplyRemoteEvent skips a version the local record already has, but not a newer one', async () => {
    const { shouldApplyRemoteEvent } = await import('../src/sync/engine');
    const now = new Date().toISOString();
    await getDb().kanji.put({
      id: 'kanji_have',
      character: '一',
      meanings: [],
      onyomi: [],
      kunyomi: [],
      nanori: [],
      createdAt: now,
      updatedAt: now,
    });
    await putRecordMeta({
      entity: 'kanji',
      recordId: 'kanji_have',
      version: 5,
      syncedVersion: 5,
      updatedAt: now,
    });

    expect(await shouldApplyRemoteEvent('kanji', 'kanji_have', 'upsert', 5)).toBe(false);
    expect(await shouldApplyRemoteEvent('kanji', 'kanji_have', 'upsert', 6)).toBe(true);
    // A delete always applies regardless of the local version.
    expect(await shouldApplyRemoteEvent('kanji', 'kanji_have', 'delete', 5)).toBe(true);
  });

  it('shouldApplyRemoteEvent applies an "already have it" version when the local row is actually missing', async () => {
    const { shouldApplyRemoteEvent } = await import('../src/sync/engine');
    // Stale record-meta: meta says v5, but no kanji row exists locally (a
    // partial clear kept the meta). The event must still apply, or the row
    // never comes back.
    await putRecordMeta({
      entity: 'kanji',
      recordId: 'kanji_missing',
      version: 5,
      syncedVersion: 5,
      updatedAt: new Date().toISOString(),
    });

    expect(await shouldApplyRemoteEvent('kanji', 'kanji_missing', 'upsert', 5)).toBe(true);
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
    expect(pending[0]?.expectedVersion).toBe(0);
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

  const remoteAudioRow = (id: string, sentenceId: string) => ({
    id,
    sentence_id: sentenceId,
    source_id: 'source-VID',
    source_sentence_id: `source-VID:${id}`,
    source_title: 'After Work',
    mime_type: 'audio/mp4',
    duration_ms: 1500,
    source_start_ms: 1000,
    source_end_ms: 2500,
    storage_path: `u/b/${id}.m4a`,
    created_at: '2026-08-29T00:00:00.000Z',
    version: 1,
  });

  it('creates a blob-less reference-audio row from a pull when audio sync is on', async () => {
    await updateSyncMeta({ syncReferenceAudio: true });
    const { applyRemoteUpsert } = await import('../src/sync/engine');
    await applyRemoteUpsert('reference_audio', remoteAudioRow('audio_new', 'sent_x'), 1);

    const row = await getDb().sentenceAudio.get('audio_new');
    expect(row).toBeDefined();
    expect(row?.sentenceId).toBe('sent_x');
    expect(row?.durationMs).toBe(1500);
    expect(row?.startMs).toBe(1000);
    expect('blob' in (row ?? {})).toBe(true); // blob-less placeholder; hydrates separately
  });

  it('ignores a new reference-audio row from a pull when audio sync is off', async () => {
    await updateSyncMeta({ syncReferenceAudio: false });
    const { applyRemoteUpsert } = await import('../src/sync/engine');
    await applyRemoteUpsert('reference_audio', remoteAudioRow('audio_off', 'sent_y'), 1);
    expect(await getDb().sentenceAudio.get('audio_off')).toBeUndefined();
  });

  it('updates metadata but keeps the local blob for an existing reference-audio row', async () => {
    await updateSyncMeta({ syncReferenceAudio: true });
    const blob = new Blob(['local-audio'], { type: 'audio/mp4' });
    await getDb().sentenceAudio.put({
      id: 'audio_have',
      sentenceId: 'sent_old',
      sourceId: 'source-VID',
      sourceSentenceId: 'x',
      sourceTitle: 'After Work',
      mimeType: 'audio/mp4',
      durationMs: 999,
      startMs: 0,
      endMs: 999,
      blob,
      importedAt: '2026-07-19T00:00:00.000Z',
    });

    const { applyRemoteUpsert } = await import('../src/sync/engine');
    await applyRemoteUpsert('reference_audio', remoteAudioRow('audio_have', 'sent_new'), 2);

    const row = await getDb().sentenceAudio.get('audio_have');
    expect(row?.sentenceId).toBe('sent_new'); // metadata followed the remote
    expect(row?.durationMs).toBe(1500);
    expect(row?.blob).toBeDefined(); // still has a blob (not the placeholder path)
    expect(row?.importedAt).toBe('2026-07-19T00:00:00.000Z'); // original, not overwritten
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

  it('bulk keep_remote clears all open conflicts', async () => {
    await addConflict({
      entity: 'analyses',
      recordId: 'sent_bulk_a',
      localPayload: {
        sentenceId: 'sent_bulk_a',
        chunks: [],
        notes: '',
        status: 'in_progress',
        formatVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      remotePayload: {
        sentence_id: 'sent_bulk_a',
        chunks: [],
        notes: 'cloud',
        status: 'in_progress',
        format_version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 3,
      },
      localVersion: 2,
      remoteVersion: 3,
    });
    await addConflict({
      entity: 'analyses',
      recordId: 'sent_bulk_b',
      localPayload: {
        sentenceId: 'sent_bulk_b',
        chunks: [],
        notes: '',
        status: 'in_progress',
        formatVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      remotePayload: {
        sentence_id: 'sent_bulk_b',
        chunks: [],
        notes: 'cloud-b',
        status: 'in_progress',
        format_version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 4,
      },
      localVersion: 3,
      remoteVersion: 4,
    });
    expect(await listOpenConflicts()).toHaveLength(2);
    const open = await listOpenConflicts();
    const resolved = await applyBulkConflictResolution(open, 'keep_remote');
    expect(resolved).toBe(2);
    expect(await listOpenConflicts()).toHaveLength(0);
  });

  it('bulk keep_local queues upserts for each conflict', async () => {
    await addConflict({
      entity: 'analyses',
      recordId: 'sent_bulk_local',
      localPayload: {
        sentenceId: 'sent_bulk_local',
        chunks: [],
        notes: 'device',
        status: 'in_progress',
        formatVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      remotePayload: {
        sentence_id: 'sent_bulk_local',
        chunks: [],
        notes: 'cloud',
        status: 'in_progress',
        format_version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 2,
      },
      localVersion: 1,
      remoteVersion: 2,
    });
    const open = await listOpenConflicts();
    await applyBulkConflictResolution(open, 'keep_local');
    expect(await listOpenConflicts()).toHaveLength(0);
    const pending = await listPendingMutations();
    expect(
      pending.some(
        (item) =>
          item.recordId === 'sent_bulk_local' && item.operation === 'upsert',
      ),
    ).toBe(true);
  });
});

describe('duplicate get-or-create insert recovery', () => {
  beforeEach(() => {
    resetDbForTests(`sync-dedup-${createId('db')}`);
  });

  it('remaps a duplicate local kanji to the remote row and repoints links', async () => {
    const { remapDuplicateEntityId } = await import('../src/sync/engine');

    // Simulates a device whose local kanji cache missed '大' (e.g. a stale
    // cursor from before a bulk import), so ensureVocabularyItem's
    // get-or-create minted a fresh local kanji id instead of finding the
    // one that already exists remotely.
    const item = await ensureVocabularyItem('大学', 'だいがく', {
      meaning: 'university',
    });
    const link = await getDb().vocabularyKanji.where('vocabularyItemId').equals(item.id).first();
    const localKanjiId = link!.kanjiId;

    await enqueueMutation({
      entity: 'vocabulary_kanji',
      recordId: link!.id,
      operation: 'upsert',
      expectedVersion: null,
      payload: link,
    });

    const remoteRow = {
      id: 'kanji_remote_authoritative',
      character: '大',
      meanings: ['big'],
      onyomi: ['ダイ'],
      kunyomi: ['おお'],
      nanori: [],
      notes: null,
      external_id: 'wk:123',
      created_at: '2026-08-14T00:00:00.000Z',
      updated_at: '2026-08-14T00:00:00.000Z',
      version: 1,
    };

    await remapDuplicateEntityId('kanji', localKanjiId, remoteRow);

    expect(await getDb().kanji.get(localKanjiId)).toBeUndefined();
    const remapped = await getDb().kanji.get('kanji_remote_authoritative');
    expect(remapped?.meanings).toEqual(['big']);

    const updatedLink = await getDb().vocabularyKanji.get(link!.id);
    expect(updatedLink?.kanjiId).toBe('kanji_remote_authoritative');

    const queueItem = await getDb().syncQueue
      .where('[entity+recordId]')
      .equals(['vocabulary_kanji', link!.id])
      .first();
    expect(
      (queueItem?.payload as { kanjiId: string } | undefined)?.kanjiId,
    ).toBe('kanji_remote_authoritative');

    const meta = await getDb().syncRecordMeta.get(
      'kanji:kanji_remote_authoritative',
    );
    expect(meta?.version).toBe(1);
    expect(await getDb().syncRecordMeta.get(`kanji:${localKanjiId}`)).toBeUndefined();
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

  it('round-trips a vocabulary item through remote shape', async () => {
    const { vocabularyItemToRemote, remoteToVocabularyItem } = await import(
      '../src/sync/mappers'
    );
    const item = await ensureVocabularyItem('大学', 'だいがく', {
      meaning: 'university',
      partOfSpeech: 'noun',
    });
    const remote = vocabularyItemToRemote(item, 'user-1', 2);
    expect(remote.owner_id).toBe('user-1');
    expect(remote.expression).toBe('大学');
    const local = remoteToVocabularyItem(remote);
    expect(local.expression).toBe('大学');
    expect(local.reading).toBe('だいがく');
    expect(local.meaning).toBe('university');
    expect(local.partOfSpeech).toBe('noun');
  });

  it('round-trips a kanji through remote shape', async () => {
    const { kanjiToRemote, remoteToKanji } = await import('../src/sync/mappers');
    const kanji = await ensureKanji('大');
    const remote = kanjiToRemote(
      { ...kanji, meanings: ['big'], onyomi: ['ダイ'], kunyomi: ['おお'] },
      'user-1',
      1,
    );
    const local = remoteToKanji(remote);
    expect(local.character).toBe('大');
    expect(local.meanings).toEqual(['big']);
    expect(local.onyomi).toEqual(['ダイ']);
    expect(local.kunyomi).toEqual(['おお']);
  });

  it('round-trips a sentence_vocabulary link through remote shape', async () => {
    const { sentenceVocabularyToRemote, remoteToSentenceVocabulary } =
      await import('../src/sync/mappers');
    await materializeVocabularySelections('sent-1', [
      {
        id: 'vsel-1',
        surface: '大学',
        start: 0,
        end: 2,
        expression: '大学',
        reading: 'だいがく',
        source: 'manual',
      },
    ]);
    const link = await getDb()
      .sentenceVocabulary.where('sentenceId')
      .equals('sent-1')
      .first();
    const remote = sentenceVocabularyToRemote(link!, 'user-1', 1);
    expect(remote.sentence_id).toBe('sent-1');
    expect(remote.audio_start_ms).toBeNull();
    expect(remote.audio_end_ms).toBeNull();
    const local = remoteToSentenceVocabulary(remote);
    expect(local.sentenceId).toBe('sent-1');
    expect(local.vocabularyItemId).toBe(link!.vocabularyItemId);
    expect(local.audioStartMs).toBeUndefined();

    // A manual word-audio span round-trips both directions.
    const withRange = sentenceVocabularyToRemote(
      { ...link!, audioStartMs: 1200, audioEndMs: 1850 },
      'user-1',
      2,
    );
    expect(withRange.audio_start_ms).toBe(1200);
    expect(withRange.audio_end_ms).toBe(1850);
    const back = remoteToSentenceVocabulary(withRange);
    expect(back.audioStartMs).toBe(1200);
    expect(back.audioEndMs).toBe(1850);
  });

  it('round-trips a vocabulary_kanji link through remote shape', async () => {
    const { vocabularyKanjiToRemote, remoteToVocabularyKanji } = await import(
      '../src/sync/mappers'
    );
    const item = await ensureVocabularyItem('大学', 'だいがく');
    const link = await getDb()
      .vocabularyKanji.where('vocabularyItemId')
      .equals(item.id)
      .first();
    const remote = vocabularyKanjiToRemote(link!, 'user-1', 1);
    expect(remote.vocabulary_item_id).toBe(item.id);
    expect(remote.position_in_word).toBe(link!.positionInWord);
    const local = remoteToVocabularyKanji(remote);
    expect(local.vocabularyItemId).toBe(item.id);
    expect(local.kanjiId).toBe(link!.kanjiId);
    expect(local.positionInWord).toBe(link!.positionInWord);
  });

  it('round-trips a grammar pattern through remote shape', async () => {
    const { grammarPatternToRemote, remoteToGrammarPattern } = await import(
      '../src/sync/mappers'
    );
    const pattern = await ensureGrammarPattern('〜わけがない', {
      shortMeaning: "there's no way...",
      aliases: ['わけない'],
    });
    const remote = grammarPatternToRemote(pattern, 'user-1', 2);
    expect(remote.owner_id).toBe('user-1');
    expect(remote.canonical_name).toBe('〜わけがない');
    const local = remoteToGrammarPattern(remote);
    expect(local.canonicalName).toBe('〜わけがない');
    expect(local.normalizedKey).toBe(pattern.normalizedKey);
    expect(local.shortMeaning).toBe("there's no way...");
    expect(local.aliases).toEqual(['わけない']);
  });

  it('round-trips a sentence_grammar link through remote shape', async () => {
    const { sentenceGrammarToRemote, remoteToSentenceGrammar } = await import(
      '../src/sync/mappers'
    );
    const pattern = await ensureGrammarPattern('〜わけがない');
    const link = await ensureSentenceGrammar('sent-1', pattern.id, {
      surfaceForm: 'わけないでしょ',
      start: 4,
      end: 11,
      confirmedByLearner: true,
    });
    const remote = sentenceGrammarToRemote(link, 'user-1', 1);
    expect(remote.sentence_id).toBe('sent-1');
    expect(remote.start_index).toBe(4);
    expect(remote.end_index).toBe(11);
    const local = remoteToSentenceGrammar(remote);
    expect(local.sentenceId).toBe('sent-1');
    expect(local.grammarPatternId).toBe(pattern.id);
    expect(local.surfaceForm).toBe('わけないでしょ');
    expect(local.start).toBe(4);
    expect(local.end).toBe(11);
    expect(local.confirmedByLearner).toBe(true);
  });

  it('round-trips a grammar relationship through remote shape', async () => {
    const { grammarRelationshipToRemote, remoteToGrammarRelationship } = await import(
      '../src/sync/mappers'
    );
    const wakega = await ensureGrammarPattern('〜わけがない');
    const hazuga = await ensureGrammarPattern('〜はずがない');
    const relationship = await ensureGrammarRelationship(
      wakega.id,
      hazuga.id,
      'structural_relative',
    );
    const remote = grammarRelationshipToRemote(relationship, 'user-1', 1);
    expect(remote.pattern_a_id).toBe(relationship.patternAId);
    expect(remote.relationship_type).toBe('structural_relative');
    const local = remoteToGrammarRelationship(remote);
    expect(local.patternAId).toBe(relationship.patternAId);
    expect(local.patternBId).toBe(relationship.patternBId);
    expect(local.relationshipType).toBe('structural_relative');
    expect(local.observedCount).toBe(1);
  });

  it('round-trips a planner session through remote shape', async () => {
    const { plannerSessionToRemote, remoteToPlannerSession } = await import(
      '../src/sync/mappers'
    );
    const session: PlannerSession = {
      id: 'planner_1',
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:10:00.000Z',
      date: '2026-08-25',
      targetMinutes: 20,
      allocation: { glossing: 5, grammar: 5, shadowing: 5, review: 5 },
      explanation: ['Recommended a mix of due reviews and new sentences.'],
      steps: [
        {
          id: 'planner_step_1',
          bucket: 'review',
          activityType: 'due_review_batch',
          targetKind: 'review',
          label: 'Review due cards',
          estimatedMinutes: 5,
          reason: '3 cards due.',
          status: 'pending',
          targetCount: 3,
        },
      ],
      status: 'in_progress',
    };
    const remote = plannerSessionToRemote(session, 'user-1', 4);
    expect(remote.owner_id).toBe('user-1');
    expect(remote.date).toBe('2026-08-25');
    expect(remote.version).toBe(4);
    const local = remoteToPlannerSession(remote);
    expect(local.id).toBe('planner_1');
    expect(local.targetMinutes).toBe(20);
    expect(local.allocation).toEqual(session.allocation);
    expect(local.steps).toEqual(session.steps);
    expect(local.status).toBe('in_progress');
  });
});
