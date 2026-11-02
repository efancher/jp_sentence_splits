import { getDb } from '../db/database';
import { ensureSyncMeta, getRecordMeta, putRecordMeta } from './queue';
import { getSupabase } from './supabaseClient';
import { getAudioObject, putAudioObject } from './audioStorage';
import { syncLog } from './logger';
import { setAudioProgress } from './progress';
import { trackLocalMutation } from './track';
import { remoteToReferenceAudio, sentenceAudioToReferenceMeta } from './mappers';
import type { SentenceAudio } from '../domain/types';

const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const HYDRATE_CONCURRENCY = 4;
const HYDRATE_LOG_EVERY = 100;
const METADATA_PAGE_SIZE = 1000;
const ALLOWED_MIME = new Set([
  'audio/ogg',
  'audio/opus',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/webm',
  'audio/wav',
]);

/**
 * Page through the account's live `reference_audio` rows. PostgREST caps a
 * single response (1000 rows by default), so an unpaged select silently drops
 * every clip past the first page.
 */
async function fetchReferenceAudioRows(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  userId: string,
  columns: string,
): Promise<{ data: Record<string, unknown>[]; error: { message: string } | null }> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += METADATA_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('reference_audio')
      .select(columns)
      .eq('owner_id', userId)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, from + METADATA_PAGE_SIZE - 1);
    if (error) return { data: rows, error };
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < METADATA_PAGE_SIZE) return { data: rows, error: null };
  }
}

function isWifiConnection(): boolean {
  const connection = (
    navigator as Navigator & {
      connection?: { type?: string; effectiveType?: string; saveData?: boolean };
    }
  ).connection;
  if (!connection) return true;
  if (connection.saveData) return false;
  if (connection.type === 'wifi' || connection.type === 'ethernet') return true;
  if (connection.type === 'cellular') return false;
  return true;
}

export async function uploadReferenceAudio(input: {
  audio: SentenceAudio;
  bookId?: string;
  ownerId: string;
}): Promise<string | null> {
  const meta = await ensureSyncMeta();
  if (!meta.syncReferenceAudio) return null;

  const supabase = getSupabase();
  if (!supabase) return null;

  if (!ALLOWED_MIME.has(input.audio.mimeType)) {
    syncLog('warn', 'Rejected audio MIME type', 'AUDIO_MIME', {
      mime: input.audio.mimeType,
    });
    throw new Error(`Unsupported audio type: ${input.audio.mimeType}`);
  }
  if (input.audio.blob.size > MAX_AUDIO_BYTES) {
    throw new Error('Audio file exceeds 50 MiB limit');
  }

  const ext =
    input.audio.mimeType.includes('ogg') || input.audio.mimeType.includes('opus')
      ? 'opus'
      : input.audio.mimeType.includes('mpeg')
        ? 'mp3'
        : input.audio.mimeType.includes('wav')
          ? 'wav'
          : 'm4a';
  const bookPart = input.bookId ?? 'unassigned';
  const path = `${input.ownerId}/${bookPart}/${input.audio.id}.${ext}`;

  try {
    await putAudioObject(supabase, path, input.audio.blob, input.audio.mimeType);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    syncLog('error', message, 'AUDIO_UPLOAD');
    throw new Error(message);
  }

  const payload = {
    ...sentenceAudioToReferenceMeta(input.audio, input.bookId),
    storagePath: path,
    sizeBytes: input.audio.blob.size,
  };
  await trackLocalMutation({
    entity: 'reference_audio',
    recordId: input.audio.id,
    operation: 'upsert',
    payload,
  });
  return path;
}

async function fetchFromStorage(storagePath: string): Promise<Blob | null> {
  const meta = await ensureSyncMeta();
  if (meta.wifiOnlyAudioDownload && !isWifiConnection()) {
    syncLog('info', 'Skipping audio download (Wi-Fi only)', 'AUDIO_WIFI');
    return null;
  }

  const supabase = getSupabase();
  if (!supabase) return null;

  // A stalled download must not wedge whoever is waiting on it (the hydrate
  // pass) — supabase-js has no request timeout of its own.
  const { blob, error } = await Promise.race([
    getAudioObject(supabase, storagePath),
    new Promise<{ blob: null; error: string }>((resolve) =>
      setTimeout(
        () => resolve({ blob: null, error: `download timed out: ${storagePath}` }),
        DOWNLOAD_TIMEOUT_MS,
      ),
    ),
  ]);
  if (!blob) {
    syncLog('error', error ?? 'download failed', 'AUDIO_DOWNLOAD');
    return null;
  }
  return blob;
}

export async function downloadReferenceAudio(
  audioId: string,
  storagePath: string,
): Promise<Blob | null> {
  const db = getDb();
  const existing = await db.sentenceAudio.get(audioId);
  if (existing?.blob?.size) return existing.blob;
  return fetchFromStorage(storagePath);
}

/**
 * Re-downloads a sentence's reference audio from Supabase Storage and
 * overwrites the local copy, bypassing the local cache. Safari's IndexedDB
 * occasionally hands back a Blob that fails on playback (WebKitBlobResource
 * error) even though its metadata/size look fine; the cloud original is
 * unaffected, so refetching it heals the local cache.
 */
export async function repairSentenceAudio(audioId: string): Promise<Blob | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data: row, error } = await supabase
    .from('reference_audio')
    .select('storage_path, mime_type')
    .eq('id', audioId)
    .maybeSingle();
  const storagePath = (row as { storage_path?: string } | null)?.storage_path;
  if (error || !storagePath) {
    syncLog('warn', error?.message ?? 'No cloud copy to repair from', 'AUDIO_REPAIR');
    return null;
  }

  const blob = await fetchFromStorage(storagePath);
  if (!blob) return null;

  const db = getDb();
  await db.sentenceAudio.update(audioId, {
    blob,
    mimeType: (row as { mime_type?: string } | null)?.mime_type ?? blob.type,
  });
  syncLog('info', 'Repaired local audio blob from cloud copy', 'AUDIO_REPAIR', { audioId });
  return blob;
}

/**
 * Upload every local `sentenceAudio` blob that never made it to Storage —
 * recovery for the 2026-09-27 incident where a long import's upload loop
 * aborted partway on one clip's transient failure, silently stranding every
 * clip after it locally-only (fixed forward: each clip's upload is now
 * isolated, so a fresh import can't repeat this, but past imports can still
 * be missing clips this never retried). Diffs the account's `reference_audio`
 * ids against local `sentenceAudio` ids and pushes only what's missing — a
 * clip already in Storage is never re-uploaded. No-op when audio sync is
 * off. Returns `{ uploaded, failed }`.
 */
export async function pushMissingReferenceAudio(): Promise<{ uploaded: number; failed: number }> {
  const meta = await ensureSyncMeta();
  if (!meta.syncReferenceAudio) return { uploaded: 0, failed: 0 };

  const supabase = getSupabase();
  if (!supabase) return { uploaded: 0, failed: 0 };
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return { uploaded: 0, failed: 0 };

  const db = getDb();
  const [localAudio, remoteRows] = await Promise.all([
    db.sentenceAudio.toArray(),
    fetchReferenceAudioRows(supabase, userId, 'id'),
  ]);
  if (remoteRows.error) {
    syncLog('warn', remoteRows.error.message, 'AUDIO_PUSH');
    return { uploaded: 0, failed: 0 };
  }
  const remoteIds = new Set((remoteRows.data ?? []).map((row) => String(row.id)));
  // A blob-less stub from resyncReferenceAudio/the sync engine has nothing
  // to push — only a locally-recorded clip with real audio is a candidate.
  const missing = localAudio.filter((audio) => !remoteIds.has(audio.id) && audio.blob.size > 0);
  if (missing.length === 0) return { uploaded: 0, failed: 0 };

  const memberships = await db.bookSentences
    .where('sentenceId')
    .anyOf(missing.map((audio) => audio.sentenceId))
    .toArray();
  const bookIdBySentenceId = new Map(memberships.map((m) => [m.sentenceId, m.bookId]));

  let uploaded = 0;
  let failed = 0;
  for (const audio of missing) {
    try {
      await uploadReferenceAudio({
        audio,
        bookId: bookIdBySentenceId.get(audio.sentenceId),
        ownerId: userId,
      });
      uploaded += 1;
    } catch (err) {
      failed += 1;
      syncLog('warn', err instanceof Error ? err.message : String(err), 'AUDIO_PUSH_SKIP');
    }
  }
  return { uploaded, failed };
}

export async function clearDownloadedAudioCache(): Promise<number> {
  const db = getDb();
  const count = await db.sentenceAudio.count();
  await db.sentenceAudio.clear();
  return count;
}

/**
 * Pull every `reference_audio` row for the signed-in user, create a
 * blob-less local `sentenceAudio` row for any that's missing (audio imported
 * on another device, or a re-segmentation backfill), then download the
 * blobs. Use after "Clear audio cache" or to force-pick-up audio that
 * incremental sync's cursor has already passed. No-op when audio sync is
 * off. Returns the number of rows now present locally.
 */
export async function resyncReferenceAudio(): Promise<number> {
  const meta = await ensureSyncMeta();
  if (!meta.syncReferenceAudio) return 0;

  const supabase = getSupabase();
  if (!supabase) return 0;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return 0;

  const { data, error } = await fetchReferenceAudioRows(
    supabase,
    userId,
    'id, sentence_id, source_id, source_sentence_id, source_title, source_url, mime_type, duration_ms, source_start_ms, source_end_ms, created_at',
  );
  if (error) {
    syncLog('warn', error.message, 'AUDIO_RESYNC');
    return 0;
  }

  const db = getDb();
  for (const row of data ?? []) {
    const id = String(row.id);
    if (await db.sentenceAudio.get(id)) continue;
    await db.sentenceAudio.put({
      id,
      sentenceId: String(row.sentence_id ?? ''),
      sourceId: String(row.source_id ?? ''),
      sourceSentenceId: String(row.source_sentence_id ?? ''),
      sourceTitle: String(row.source_title ?? ''),
      sourceUrl: (row.source_url as string | null) ?? undefined,
      mimeType: String(row.mime_type),
      durationMs: Number(row.duration_ms ?? 0),
      startMs: Number(row.source_start_ms ?? 0),
      endMs: Number(row.source_end_ms ?? 0),
      blob: new Blob([], { type: String(row.mime_type) }),
      importedAt: String(row.created_at),
    });
  }

  // Background: this can be hundreds of downloads; don't hold the caller's UI.
  void hydrateMissingReferenceAudio().catch((error) => {
    syncLog('warn', error instanceof Error ? error.message : String(error), 'AUDIO_HYDRATE');
  });
  return (data ?? []).length;
}

/**
 * Re-sync one sentence's reference clips from the cloud, for when a clip was
 * re-cut, replaced or retired elsewhere and this device still plays the old
 * one. The per-sentence counterpart of "Re-download everything": cloud rows
 * refresh local metadata (a blob whose size no longer matches is blanked and
 * re-downloaded), and a local clip the cloud no longer lists is dropped — but
 * only one that was synced before and has no push queued, so a clip recorded
 * on this device and not yet uploaded is never lost. Returns null when offline
 * or signed out, else how many clips were refreshed and removed.
 */
export async function refreshSentenceAudioFromCloud(
  sentenceId: string,
): Promise<{ refreshed: number; removed: number } | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from('reference_audio')
    .select('*')
    .eq('owner_id', userId)
    .eq('sentence_id', sentenceId)
    .is('deleted_at', null);
  if (error) {
    syncLog('warn', error.message, 'AUDIO_REFRESH');
    return null;
  }

  const db = getDb();
  const pushQueued = async (id: string) =>
    (await db.syncQueue.where('[entity+recordId]').equals(['reference_audio', id]).count()) > 0;
  const cloudRows = (data ?? []) as Record<string, unknown>[];
  const cloudIds = new Set(cloudRows.map((row) => String(row.id)));

  let refreshed = 0;
  for (const row of cloudRows) {
    const meta = remoteToReferenceAudio(row);
    if (await pushQueued(meta.id)) continue;
    const existing = await db.sentenceAudio.get(meta.id);
    const staleBlob =
      !!existing && meta.sizeBytes! > 0 && existing.blob.size > 0 && existing.blob.size !== meta.sizeBytes;
    await db.sentenceAudio.put({
      ...(existing ?? { blob: new Blob([], { type: meta.mimeType }), importedAt: meta.importedAt }),
      ...(staleBlob ? { blob: new Blob([], { type: meta.mimeType }) } : {}),
      id: meta.id,
      sentenceId: meta.sentenceId,
      sourceId: meta.sourceId,
      sourceSentenceId: meta.sourceSentenceId,
      sourceTitle: meta.sourceTitle,
      sourceUrl: meta.sourceUrl,
      mimeType: meta.mimeType,
      durationMs: meta.durationMs,
      startMs: meta.startMs,
      endMs: meta.endMs,
      trimStartMs: meta.trimStartMs,
      trimEndMs: meta.trimEndMs,
    });
    const version = Number(row.version ?? 1);
    await putRecordMeta({
      entity: 'reference_audio',
      recordId: meta.id,
      version,
      syncedVersion: version,
      updatedAt: String(row.updated_at ?? new Date().toISOString()),
    });
    refreshed += 1;
  }

  let removed = 0;
  for (const local of await db.sentenceAudio.where('sentenceId').equals(sentenceId).toArray()) {
    if (cloudIds.has(local.id) || (await pushQueued(local.id))) continue;
    if (!(await getRecordMeta('reference_audio', local.id))) continue;
    await db.sentenceAudio.delete(local.id);
    removed += 1;
  }

  await hydrateMissingReferenceAudio();
  return { refreshed, removed };
}

/**
 * Download the blobs for any local `sentenceAudio` rows that only have
 * metadata — i.e. rows the sync engine created from a cloud `reference_audio`
 * row that this device never imported itself. Runs after a pull cycle.
 * Respects the Wi-Fi-only setting via `fetchFromStorage`; a row it can't
 * fetch now is retried on the next cycle. No-op when audio sync is off.
 */
let hydrateInFlight: Promise<number> | null = null;

/** Single-flight: overlapping callers (sync cycle, Settings re-sync) share one pass. */
export function hydrateMissingReferenceAudio(): Promise<number> {
  hydrateInFlight ??= hydrateOnce().finally(() => {
    hydrateInFlight = null;
  });
  return hydrateInFlight;
}

/** After a scan that found nothing to download, cycle-triggered hydration sleeps this long. */
const CYCLE_HYDRATE_QUIET_MS = 10 * 60_000;
/** First cycle-triggered scan waits this long after launch so it doesn't contend with the first screens. */
const CYCLE_HYDRATE_STARTUP_DELAY_MS = 20_000;
const moduleLoadedAt = Date.now();
let lastCleanScanAt = 0;

/**
 * Hydration as run at the end of a sync cycle. The scan reads every
 * `sentenceAudio` row *including its blob* (IndexedDB cannot skip values), so
 * doing it after each save-triggered cycle kept IndexedDB busy and stalled page
 * loads. Skip it shortly after launch and for a while after a scan that found
 * nothing missing; explicit callers (Settings, resync) use
 * `hydrateMissingReferenceAudio` and always scan.
 */
export async function hydrateReferenceAudioAfterCycle(): Promise<number> {
  const now = Date.now();
  if (now - moduleLoadedAt < CYCLE_HYDRATE_STARTUP_DELAY_MS) return 0;
  if (now - lastCleanScanAt < CYCLE_HYDRATE_QUIET_MS) return 0;
  return hydrateMissingReferenceAudio();
}

async function hydrateOnce(): Promise<number> {
  const meta = await ensureSyncMeta();
  if (!meta.syncReferenceAudio) return 0;

  const supabase = getSupabase();
  if (!supabase) return 0;

  const db = getDb();
  const scanStart = Date.now();
  const missing = (await db.sentenceAudio.toArray()).filter(
    (row) => !row.blob || row.blob.size === 0,
  );
  syncLog('debug', `Hydrate scan: ${missing.length} missing, ${Date.now() - scanStart}ms`, 'AUDIO_HYDRATE');
  if (missing.length === 0) {
    lastCleanScanAt = Date.now();
    return 0;
  }

  // Chunked: a single `.in()` over a whole cleared cache overflows the URL limit.
  const byId = new Map<string, { storage_path?: string; mime_type?: string }>();
  for (let i = 0; i < missing.length; i += 200) {
    const { data, error } = await supabase
      .from('reference_audio')
      .select('id, storage_path, mime_type')
      .in('id', missing.slice(i, i + 200).map((row) => row.id));
    if (error) {
      syncLog('warn', error.message, 'AUDIO_HYDRATE');
      return 0;
    }
    for (const row of data ?? []) byId.set(String(row.id), row as { storage_path?: string; mime_type?: string });
  }

  syncLog('info', `Hydrating ${missing.length} reference-audio blob(s)`, 'AUDIO_HYDRATE');
  let healed = 0;
  let attempted = 0;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < missing.length) {
      const row = missing[next++]!;
      attempted += 1;
      setAudioProgress(missing.length, attempted);
      const info = byId.get(row.id);
      if (info?.storage_path) {
        const blob = await fetchFromStorage(info.storage_path);
        // null: offline / Wi-Fi-only / gone — retry next cycle
        if (blob) {
          await db.sentenceAudio.update(row.id, {
            blob,
            mimeType: info.mime_type ?? row.mimeType,
          });
          healed += 1;
        }
      }
      if (attempted % HYDRATE_LOG_EVERY === 0) {
        syncLog('info', `Reference-audio hydrate: ${attempted}/${missing.length}`, 'AUDIO_HYDRATE');
      }
    }
  }
  setAudioProgress(missing.length, 0);
  await Promise.all(Array.from({ length: HYDRATE_CONCURRENCY }, worker));
  setAudioProgress(0, 0);
  syncLog('info', `Hydrated ${healed}/${missing.length} reference-audio blob(s)`, 'AUDIO_HYDRATE');
  return healed;
}
