import { z } from 'zod';

import { YOUTUBE_MINING_API_BASE } from '../appConfig';

/**
 * Client for `POST /boundary-backfill/jobs` + `GET /boundary-backfill/jobs/{id}`
 * on the tailnet-only youtube-mining-api service (server/youtube-mining/app/
 * boundary_backfill.py). Runs scripts/refine-reference-clip-boundaries.ts on
 * the box for one book: without `apply` it only reports how far each existing
 * clip's cut points would move; with it, clips are re-cut and replaced.
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

export async function startBoundaryBackfill(bookId: string, apply: boolean): Promise<string> {
  const response = await fetch(`${API_BASE}/boundary-backfill/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookId, apply }),
  });
  if (!response.ok) {
    throw new Error(`Failed to start boundary refinement: ${await readErrorDetail(response)}`);
  }
  const data = (await response.json()) as { jobId: string };
  return data.jobId;
}

const boundaryBackfillStatusSchema = z.object({
  status: z.enum(['running', 'done', 'error']),
  message: z.string(),
  log: z.array(z.string()),
  startedAt: z.number(),
});

export type BoundaryBackfillStatus = z.infer<typeof boundaryBackfillStatusSchema>;

export async function getBoundaryBackfillJob(jobId: string): Promise<BoundaryBackfillStatus> {
  const response = await fetch(`${API_BASE}/boundary-backfill/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch boundary refinement status: ${await readErrorDetail(response)}`);
  }
  return boundaryBackfillStatusSchema.parse(await response.json());
}
