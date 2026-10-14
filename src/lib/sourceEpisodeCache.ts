import { getDb } from '../db/database';
import { getSupabase } from '../sync/supabaseClient';

import { CLIP_SAMPLE_RATE, decodeOpusRange, encodeWav, isOpusRangeDecodingSupported } from './opusRange';

const SOURCE_BUCKET = 'source-audio';
const DOWNLOAD_TIMEOUT_MS = 60_000;
const YOUTUBE_ID = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_URL_ID = /(?:v=|\/embed\/|\/shorts\/|\/live\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

/** Same rule as the mining box's `extract_video_id`; undefined for podcast/other URLs. */
export function youtubeVideoId(url: string): string | undefined {
  const value = url.trim();
  if (YOUTUBE_ID.test(value)) return value;
  return YOUTUBE_URL_ID.exec(value)?.[1];
}

/** True when this device could serve the source range itself (YouTube id + Opus decoding + cloud client). */
export function canAdjustWithoutBox(url: string): boolean {
  return Boolean(youtubeVideoId(url)) && isOpusRangeDecodingSupported() && getSupabase() !== null;
}

export function deviceUnavailableReason(url: string): string {
  if (!youtubeVideoId(url)) return 'not a YouTube source';
  if (!isOpusRangeDecodingSupported()) return 'this browser has no WebCodecs audio decoder';
  if (getSupabase() === null) return 'cloud storage not configured';
  return 'unknown';
}

export async function hasCachedEpisode(videoId: string): Promise<boolean> {
  return (await getDb().sourceEpisodes.get(videoId)) !== undefined;
}

async function downloadEpisode(videoId: string): Promise<Blob> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Cloud storage is not configured.');
  const { data, error } = await Promise.race([
    supabase.storage.from(SOURCE_BUCKET).download(`${videoId}.opus`),
    new Promise<{ data: null; error: { message: string } }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: { message: 'download timed out' } }), DOWNLOAD_TIMEOUT_MS),
    ),
  ]);
  if (error || !data) {
    throw new Error(`Could not download the episode audio: ${error?.message ?? 'no data'}`);
  }
  return data;
}

/** The episode's Opus audio: this device's copy, else downloaded from the bucket and kept. */
export async function getEpisodeBlob(videoId: string): Promise<Blob> {
  const db = getDb();
  const cached = await db.sourceEpisodes.get(videoId);
  if (cached?.blob.size) return cached.blob;
  const blob = await downloadEpisode(videoId);
  await db.sourceEpisodes.put({ id: videoId, blob, cachedAt: new Date().toISOString() });
  return blob;
}

/** `[startMs, endMs)` of the episode as a WAV blob, decoded on this device. */
export async function episodeRangeWav(
  url: string,
  startMs: number,
  endMs: number,
): Promise<{ blob: Blob; durationMs: number }> {
  const videoId = youtubeVideoId(url);
  if (!videoId) throw new Error('This source is not a YouTube video, so it is only available from the mining box.');
  const episode = await getEpisodeBlob(videoId);
  const samples = await decodeOpusRange(episode, startMs, endMs);
  return {
    blob: encodeWav(samples, CLIP_SAMPLE_RATE),
    durationMs: Math.round((samples.length * 1000) / CLIP_SAMPLE_RATE),
  };
}

/** Drop-in for the mining box's `clipFromSource`, served from the device's own episode copy. */
export async function clipFromEpisode(
  url: string,
  cuts: { startMs: number; endMs: number }[],
): Promise<{ blob: Blob; durationMs: number; mimeType: string }[]> {
  const clips = [];
  for (const cut of cuts) {
    const clip = await episodeRangeWav(url, cut.startMs, cut.endMs);
    clips.push({ ...clip, mimeType: 'audio/wav' });
  }
  return clips;
}
