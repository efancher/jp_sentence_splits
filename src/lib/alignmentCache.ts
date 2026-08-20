import type { AlignmentResult } from '../domain/types';
import { alignAudio } from './analysisApi';

/**
 * Checks the Dexie cache before calling the (slow, server-side) forced-
 * alignment service, and saves a successful result back to it. Returns
 * `undefined` on any failure/unreachable-server case — never throws, since
 * an unavailable server is expected/ordinary here (docs/STATUS.md Phase 9,
 * Milestone 2b).
 *
 * Kept out of analysisApi.ts itself: tests mock `alignAudio` via
 * `vi.mock('../src/lib/analysisApi', ...)`, which only intercepts calls
 * made from *other* modules importing that export — a same-module call
 * (this function living inside analysisApi.ts and calling its neighbor
 * directly) would bypass the mock entirely.
 */
export async function loadOrComputeAlignment(
  id: string,
  blob: Blob,
  transcript: string,
  get: (id: string) => Promise<AlignmentResult | undefined>,
  save: (id: string, result: AlignmentResult) => Promise<void>,
): Promise<AlignmentResult | undefined> {
  const cached = await get(id);
  if (cached) return cached;
  const fetched = await alignAudio(blob, transcript);
  if (fetched) await save(id, fetched);
  return fetched ?? undefined;
}
