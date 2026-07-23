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

export async function downloadReferenceAudio(
  audioId: string,
  storagePath: string,
): Promise<Blob | null> {
  const meta = await ensureSyncMeta();
  if (meta.wifiOnlyAudioDownload && !isWifiConnection()) {
    syncLog('info', 'Skipping audio download (Wi-Fi only)', 'AUDIO_WIFI');
    return null;
  }

  const db = getDb();
  const existing = await db.sentenceAudio.get(audioId);
  if (existing?.blob?.size) return existing.blob;

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

export async function clearDownloadedAudioCache(): Promise<number> {
  const db = getDb();
  const count = await db.sentenceAudio.count();
  await db.sentenceAudio.clear();
  return count;
}
