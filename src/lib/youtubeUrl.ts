/**
 * Pull the 11-character video id out of a YouTube URL (or accept a bare id).
 * Mirrors `extract_video_id` in server/youtube-mining/app/youtube.py so the
 * wizard can warn about a re-mine before the job is even created.
 */

const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_ID_IN_URL_RE =
  /(?:v=|\/embed\/|\/shorts\/|\/live\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

export function extractYouTubeId(urlOrId: string): string | null {
  const value = urlOrId.trim();
  if (YOUTUBE_ID_RE.test(value)) return value;
  const match = YOUTUBE_ID_IN_URL_RE.exec(value);
  return match ? match[1]! : null;
}
