import { z } from 'zod';

import { YOUTUBE_MINING_API_BASE } from '../appConfig';

/**
 * Client for the tailnet-only YouTube-mining service
 * (server/youtube-mining in this repo, docs/STATUS.md "YouTube mining"
 * phase). Unlike analysisApi.ts's "never throws, null on failure"
 * contract (an optional enhancement elsewhere in the app), this is the
 * entire feature src/pages/YouTubeMinePage.tsx is actively driving —
 * failures throw with a message the page can show directly.
 */

// import.meta.env is unavailable to vite.config.ts (see appConfig.ts's
// comment on YOUTUBE_MINING_API_BASE), but this module is browser-only.
const API_BASE: string =
  import.meta.env.VITE_YOUTUBE_MINING_API_BASE || YOUTUBE_MINING_API_BASE;

const morphemeTokenSchema = z.object({
  surface: z.string(),
  start: z.number(),
  end: z.number(),
  lemma: z.string(),
  reading: z.string().optional(),
  lemmaReading: z.string().optional(),
  pos: z.string().optional(),
});

const sourceInfoSchema = z.object({
  id: z.string(),
  type: z.literal('youtube'),
  url: z.string(),
  videoId: z.string(),
  title: z.string(),
  channel: z.string().nullable().optional(),
  durationMs: z.number().nullable().optional(),
});

const cueSchema = z.object({
  index: z.number(),
  startMs: z.number(),
  endMs: z.number(),
  japanese: z.string(),
  isAuto: z.boolean(),
  englishGuess: z.string().nullable().optional(),
  lowConfidence: z.boolean().optional(),
  sourceIndexes: z.array(z.number()).nullable().optional(),
});

const transcriptSegmentSchema = z.object({
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  isAuto: z.boolean().optional(),
  lowConfidence: z.boolean().optional(),
});

const translatedRowSchema = z.object({
  index: z.number(),
  japanese: z.string(),
  english: z.string().nullable().optional(),
  startMs: z.number(),
  endMs: z.number(),
});

/**
 * `status` is the coarse lifecycle flag the linear review UI polls;
 * `stage` is the staged wizard's re-runnable pipeline position
 * (docs/mining-wizard-spec.md). `message` is the human-readable progress
 * line (it was sent as `stage` before the wizard rework).
 */
const jobStatusSchema = z.object({
  jobId: z.string(),
  status: z.enum(['pending', 'fetching', 'parsing', 'ready', 'error']),
  stage: z.enum([
    'fetching',
    'transcript',
    'segment',
    'translate',
    'ready',
    'error',
  ]),
  message: z.string(),
  /** Seconds the current `message` has been showing — for the wizard's "N min elapsed" line. */
  elapsedSeconds: z.number().optional().default(0),
  error: z.string().nullable().optional(),
  source: sourceInfoSchema.nullable().optional(),
  transcript: z.array(transcriptSegmentSchema).nullable().optional(),
  cues: z.array(cueSchema).nullable().optional(),
  rows: z.array(translatedRowSchema).nullable().optional(),
});

const clipResponseSchema = z.object({
  sentenceId: z.string(),
  japanese: z.string(),
  reading: z.string().nullable().optional(),
  english: z.string().nullable().optional(),
  startMs: z.number(),
  endMs: z.number(),
  subtitleStartMs: z.number(),
  subtitleEndMs: z.number(),
  adjustedStartMs: z.number(),
  adjustedEndMs: z.number(),
  transcriptStatus: z.enum([
    'unverified',
    'auto-caption',
    'manually-corrected',
    'verified',
  ]),
  tokens: z.array(morphemeTokenSchema).nullable().optional(),
  audio: z.object({
    mimeType: z.literal('audio/mp4'),
    durationMs: z.number(),
  }),
});

const commitResponseSchema = z.object({
  sentences: z.array(
    clipResponseSchema.extend({ audioBase64: z.string() }),
  ),
});

const resegmentedCueSchema = z.object({
  japanese: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  reading: z.string().nullable().optional(),
  tokens: z.array(morphemeTokenSchema).nullable().optional(),
  sourceIndexes: z.array(z.number()),
});

export type MiningSourceInfo = z.infer<typeof sourceInfoSchema>;
export type MiningCue = z.infer<typeof cueSchema>;
export type MiningTranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export type MiningTranslatedRow = z.infer<typeof translatedRowSchema>;
export type MiningJobStatus = z.infer<typeof jobStatusSchema>;
export type MiningJobStage = MiningJobStatus['stage'];
export type MiningClipResult = z.infer<typeof clipResponseSchema>;
export type ResegmentedCue = z.infer<typeof resegmentedCueSchema>;

export interface ResegmentSentenceInput {
  japanese: string;
  startMs: number;
  endMs: number;
}

export interface ClipCueOptions {
  japanese: string;
  english?: string;
  startMs?: number;
  endMs?: number;
  generateKana?: boolean;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
  } catch {
    // fall through to the generic message below
  }
  return `${response.status} ${response.statusText}`;
}

export async function createMiningJob(url: string): Promise<string> {
  const response = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) {
    throw new Error(`Failed to start mining job: ${await readErrorDetail(response)}`);
  }
  const data = (await response.json()) as { jobId: string };
  return data.jobId;
}

const jobSummarySchema = z.object({
  jobId: z.string(),
  url: z.string(),
  title: z.string().nullable().optional(),
  status: z.enum(['pending', 'fetching', 'parsing', 'ready', 'error']),
  stage: z.enum(['fetching', 'transcript', 'segment', 'translate', 'ready', 'error']),
  message: z.string(),
  createdAt: z.number(),
});

export type MiningJobSummary = z.infer<typeof jobSummarySchema>;

/**
 * Every resumable job the service still holds — in memory or checkpointed
 * to disk (`GET /jobs`). The wizard offers these on its idle screen so an
 * import whose transcription was kicked off on one machine can be finished
 * on another.
 */
export async function listMiningJobs(): Promise<MiningJobSummary[]> {
  const response = await fetch(`${API_BASE}/jobs`);
  if (!response.ok) {
    throw new Error(`Failed to list mining jobs: ${await readErrorDetail(response)}`);
  }
  return z.array(jobSummarySchema).parse(await response.json());
}

export async function getMiningJob(jobId: string): Promise<MiningJobStatus> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch mining job status: ${await readErrorDetail(response)}`);
  }
  return jobStatusSchema.parse(await response.json());
}

export interface MiningSegmentInput {
  text: string;
  startMs: number;
  endMs: number;
  isAuto?: boolean;
  lowConfidence?: boolean;
}

/**
 * Stage the wizard's corrected transcript and (re-)run resegmentation
 * (`POST /jobs/{id}/segment`). `merge`/`split` default to the server's
 * music/punctuation heuristic; pass `merge:false, split:false` to keep the
 * segments exactly as given (syncing the job's cues to the reviewed rows
 * before translate/commit). Returns the full job status with fresh `cues`.
 */
export async function applyJobSegments(
  jobId: string,
  segments: MiningSegmentInput[],
  options: { merge?: boolean; split?: boolean } = {},
): Promise<MiningJobStatus> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      segments,
      merge: options.merge ?? null,
      split: options.split ?? true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to segment: ${await readErrorDetail(response)}`);
  }
  return jobStatusSchema.parse(await response.json());
}

/**
 * Align the EN subtitle track onto the job's current sentence boundaries
 * (`POST /jobs/{id}/translate`). Returns the job status with `rows`
 * populated. Re-runnable.
 */
export async function translateJob(jobId: string): Promise<MiningJobStatus> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/translate`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Failed to align translations: ${await readErrorDetail(response)}`);
  }
  return jobStatusSchema.parse(await response.json());
}

/**
 * Clip an explicit (startMs, endMs) span straight from the job's source
 * audio (`POST /jobs/{id}/clip`), with the sentence text supplied — no cue
 * index. The wizard's commit stage cuts every reviewed row this way.
 */
export async function clipMiningRange(
  jobId: string,
  options: ClipCueOptions,
): Promise<MiningClipResult> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/clip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      japanese: options.japanese,
      english: options.english,
      startMs: options.startMs,
      endMs: options.endMs,
      generateKana: options.generateKana ?? true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to clip sentence: ${await readErrorDetail(response)}`);
  }
  return clipResponseSchema.parse(await response.json());
}

export interface CommitRowInput {
  japanese: string;
  english?: string;
  startMs: number;
  endMs: number;
}

/**
 * Default rows per `POST /jobs/{id}/commit` request. ffmpeg runs serially
 * server-side (~0.5 s/row), so a whole long video in one request blows past
 * the tailnet proxy's response timeout and the browser reports a bare
 * "Load failed". Chunking keeps every request short; the server's
 * `commit_job` is incremental (it appends to the job's clip set), so the
 * batches accumulate into the same result a single call would have given.
 */
const COMMIT_CHUNK_SIZE = 30;

/**
 * Clip every reviewed row from the source (`POST /jobs/{id}/commit`), each
 * with its audio inline — the wizard's commit stage, replacing a per-row
 * {@link clipMiningRange} + {@link fetchMiningClipAudio} round trip. Sent in
 * batches of {@link COMMIT_CHUNK_SIZE}; `onProgress` fires after each batch
 * with the running (done, total) count.
 */
export async function commitMiningJob(
  jobId: string,
  rows: CommitRowInput[],
  options: {
    generateKana?: boolean;
    chunkSize?: number;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<{ clip: MiningClipResult; blob: Blob }[]> {
  const chunkSize = Math.max(1, options.chunkSize ?? COMMIT_CHUNK_SIZE);
  const out: { clip: MiningClipResult; blob: Blob }[] = [];
  for (let start = 0; start < rows.length; start += chunkSize) {
    const batch = rows.slice(start, start + chunkSize);
    const response = await fetch(`${API_BASE}/jobs/${jobId}/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: batch, generateKana: options.generateKana ?? true }),
    });
    if (!response.ok) {
      throw new Error(`Failed to clip sentences: ${await readErrorDetail(response)}`);
    }
    const { sentences } = commitResponseSchema.parse(await response.json());
    for (const { audioBase64, ...clip } of sentences) {
      out.push({ clip, blob: base64ToBlob(audioBase64, clip.audio.mimeType) });
    }
    options.onProgress?.(out.length, rows.length);
  }
  return out;
}

export async function fetchMiningClipAudio(
  jobId: string,
  sentenceId: string,
): Promise<Blob> {
  const response = await fetch(
    `${API_BASE}/jobs/${jobId}/clips/${sentenceId}/audio`,
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch clip audio: ${await readErrorDetail(response)}`);
  }
  return response.blob();
}

/**
 * An arbitrary span of the job's source audio, cut from the cached
 * download (server/youtube-mining `GET /jobs/{id}/audio?startMs&endMs`).
 * Every staged-wizard panel plays the source through this. Available as
 * soon as the download lands, before resegmentation.
 */
export async function fetchJobAudioRange(
  jobId: string,
  startMs: number,
  endMs: number,
): Promise<Blob> {
  const query = `?startMs=${Math.round(startMs)}&endMs=${Math.round(endMs)}`;
  const response = await fetch(`${API_BASE}/jobs/${jobId}/audio${query}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch job audio: ${await readErrorDetail(response)}`);
  }
  return response.blob();
}

/**
 * Re-segment an already-imported source's sentences without re-downloading
 * (server/youtube-mining `POST /resegment`, stateless). `merge`/`split`
 * default true — full resegmentation for drama transcripts; pass both false
 * for annotate-only (lyrics / manual mode, where sentence-final punctuation
 * isn't a reliable boundary). Returns the new cues with kana readings +
 * morpheme tokens and, per cue, which input indexes fed it.
 */
export async function resegmentSentences(
  sentences: ResegmentSentenceInput[],
  options: { merge?: boolean; split?: boolean; generateKana?: boolean } = {},
): Promise<ResegmentedCue[]> {
  const response = await fetch(`${API_BASE}/resegment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sentences,
      merge: options.merge ?? true,
      split: options.split ?? true,
      generateKana: options.generateKana ?? true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to re-segment: ${await readErrorDetail(response)}`);
  }
  return z.array(resegmentedCueSchema).parse(await response.json());
}

const reclipResponseSchema = z.object({
  clips: z.array(
    z.object({
      audioBase64: z.string(),
      mimeType: z.literal('audio/mp4'),
      durationMs: z.number(),
    }),
  ),
});

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/**
 * Re-cut reference audio onto new sentence boundaries after re-segmentation
 * (server/youtube-mining `POST /reclip`, stateless). `parentClips` are the
 * old per-fragment clips a run of new sentences descends from, in
 * video-timeline order; `cuts` are ms ranges over their concatenation.
 * Returns one m4a Blob per cut, in order. `trimSilence` tightens each cut to
 * its spoken span — for clips whose source cue timings overshoot the speech.
 */
export async function reclipResegmentedAudio(
  parentClips: Blob[],
  cuts: { startMs: number; endMs: number }[],
  options: { trimSilence?: boolean } = {},
): Promise<{ blob: Blob; durationMs: number }[]> {
  const clipsBase64 = await Promise.all(parentClips.map(blobToBase64));
  const response = await fetch(`${API_BASE}/reclip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clipsBase64, cuts, trimSilence: options.trimSilence ?? false }),
  });
  if (!response.ok) {
    throw new Error(`Failed to re-cut audio: ${await readErrorDetail(response)}`);
  }
  const { clips } = reclipResponseSchema.parse(await response.json());
  return clips.map((clip) => ({
    blob: base64ToBlob(clip.audioBase64, clip.mimeType),
    durationMs: clip.durationMs,
  }));
}

/**
 * Cut absolute (startMs, endMs) spans straight out of a video's cached
 * source audio (server/youtube-mining `POST /source-audio/clip`). The
 * service downloads + caches the source on first use, so the first call for
 * a given video is slow. Preferred over {@link reclipResegmentedAudio} for
 * re-segmentation when the book still has a reachable `sourceUrl` — it cuts
 * from the pristine original rather than concatenating lossy fragment clips.
 * Returns one m4a Blob per cut, in order.
 */
export async function clipFromSource(
  url: string,
  cuts: { startMs: number; endMs: number }[],
): Promise<{ blob: Blob; durationMs: number }[]> {
  const response = await fetch(`${API_BASE}/source-audio/clip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, cuts }),
  });
  if (!response.ok) {
    throw new Error(`Failed to clip from source: ${await readErrorDetail(response)}`);
  }
  const { clips } = reclipResponseSchema.parse(await response.json());
  return clips.map((clip) => ({
    blob: base64ToBlob(clip.audioBase64, clip.mimeType),
    durationMs: clip.durationMs,
  }));
}

/**
 * Stream one (startMs, endMs) span of a video's cached source audio
 * (server/youtube-mining `POST /source-audio/range`) — for the re-segment
 * page's boundary waveform. Like {@link clipFromSource} but a single
 * streamed m4a rather than base64, so it's cheap enough to pull a whole
 * multi-minute span. The service downloads + caches the source on first
 * use (slow first call per video).
 */
export async function fetchSourceAudioRange(
  url: string,
  startMs: number,
  endMs: number,
): Promise<Blob> {
  const response = await fetch(`${API_BASE}/source-audio/range`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      startMs: Math.round(startMs),
      endMs: Math.round(endMs),
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch source audio: ${await readErrorDetail(response)}`);
  }
  return response.blob();
}

/** Best-effort cleanup — the server also sweeps abandoned jobs on a timer. */
export async function deleteMiningJob(jobId: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/jobs/${jobId}`, { method: 'DELETE' });
  } catch {
    // best-effort only
  }
}
