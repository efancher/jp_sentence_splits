import { z } from 'zod';

import { YOUTUBE_MINING_API_BASE } from '../appConfig';

/**
 * Client for `POST /alignment-backfill/jobs` + `GET /alignment-backfill/jobs/{id}`
 * on the tailnet-only youtube-mining-api service (server/youtube-mining/app/
 * alignment_backfill.py) — precomputes forced-alignment for a book's
 * reference audio so pitch_accent/word_listening word-audio doesn't hit the
 * aligner's cold start live during study. Lets the user trigger the
 * equivalent of scripts/backfill-reference-alignment.ts from the UI, without
 * SSH access to the box.
 */

const API_BASE: string =
  import.meta.env.VITE_YOUTUBE_MINING_API_BASE || YOUTUBE_MINING_API_BASE;

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
  } catch {
    // fall through to the generic message below
  }
  return `${response.status} ${response.statusText}`;
}

export async function startAlignmentBackfill(bookId?: string): Promise<string> {
  const response = await fetch(`${API_BASE}/alignment-backfill/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookId: bookId ?? null }),
  });
  if (!response.ok) {
    throw new Error(`Failed to start alignment backfill: ${await readErrorDetail(response)}`);
  }
  const data = (await response.json()) as { jobId: string };
  return data.jobId;
}

const alignmentBackfillStatusSchema = z.object({
  status: z.enum(['running', 'done', 'error']),
  message: z.string(),
  log: z.array(z.string()),
  startedAt: z.number(),
});

export type AlignmentBackfillStatus = z.infer<typeof alignmentBackfillStatusSchema>;

export async function getAlignmentBackfillJob(jobId: string): Promise<AlignmentBackfillStatus> {
  const response = await fetch(`${API_BASE}/alignment-backfill/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch alignment backfill status: ${await readErrorDetail(response)}`);
  }
  return alignmentBackfillStatusSchema.parse(await response.json());
}
