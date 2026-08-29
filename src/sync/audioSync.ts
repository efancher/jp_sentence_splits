import { getDb } from '../db/database';
import { ensureSyncMeta } from './queue';
import { getSupabase } from './supabaseClient';
import { syncLog } from './logger';
import { trackLocalMutation } from './track';
import { sentenceAudioToReferenceMeta } from './mappers';
import type { SentenceAudio } from '../domain/types';

const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'audio/ogg',
  'audio/opus',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/webm',
]);

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
        : 'm4a';
  const bookPart = input.bookId ?? 'unassigned';
  const path = `${input.ownerId}/${bookPart}/${input.audio.id}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('reference-audio')
    .upload(path, input.audio.blob, {
      contentType: input.audio.mimeType,
      upsert: true,
    });
  if (uploadError) {
    syncLog('error', uploadError.message, 'AUDIO_UPLOAD');
    throw new Error(uploadError.message);
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

  const { data, error } = await supabase.storage
    .from('reference-audio')
    .download(storagePath);
  if (error || !data) {
    syncLog('error', error?.message ?? 'download failed', 'AUDIO_DOWNLOAD');
    return null;
  }
  return data;
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

  const { data, error } = await supabase
    .from('reference_audio')
    .select(
      'id, sentence_id, source_id, source_sentence_id, source_title, source_url, mime_type, duration_ms, source_start_ms, source_end_ms, created_at',
    )
    .eq('owner_id', userId)
    .is('deleted_at', null);
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

  await hydrateMissingReferenceAudio();
  return (data ?? []).length;
}

/**
 * Download the blobs for any local `sentenceAudio` rows that only have
 * metadata — i.e. rows the sync engine created from a cloud `reference_audio`
 * row that this device never imported itself. Runs after a pull cycle.
 * Respects the Wi-Fi-only setting via `fetchFromStorage`; a row it can't
 * fetch now is retried on the next cycle. No-op when audio sync is off.
 */
export async function hydrateMissingReferenceAudio(): Promise<number> {
  const meta = await ensureSyncMeta();
  if (!meta.syncReferenceAudio) return 0;

  const supabase = getSupabase();
  if (!supabase) return 0;

  const db = getDb();
  const missing = (await db.sentenceAudio.toArray()).filter(
    (row) => !row.blob || row.blob.size === 0,
  );
  if (missing.length === 0) return 0;

  const { data, error } = await supabase
    .from('reference_audio')
    .select('id, storage_path, mime_type')
    .in('id', missing.map((row) => row.id));
  if (error) {
    syncLog('warn', error.message, 'AUDIO_HYDRATE');
    return 0;
  }
  const byId = new Map(
    (data ?? []).map((row) => [String(row.id), row as { storage_path?: string; mime_type?: string }]),
  );

  let healed = 0;
  for (const row of missing) {
    const info = byId.get(row.id);
    if (!info?.storage_path) continue;
    const blob = await fetchFromStorage(info.storage_path);
    if (!blob) continue; // offline / Wi-Fi-only / gone — retry next cycle
    await db.sentenceAudio.update(row.id, {
      blob,
      mimeType: info.mime_type ?? row.mimeType,
    });
    healed += 1;
  }
  if (healed) syncLog('info', `Hydrated ${healed} reference-audio blob(s)`, 'AUDIO_HYDRATE');
  return healed;
}
