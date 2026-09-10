import type { AlignmentResult } from '../domain/types';
import { alignAudio } from './analysisApi';

/**
 * Resolves a reference clip's forced alignment through three tiers, cheapest
 * first: the local Dexie cache, then the synced `reference_alignment`
 * Supabase table (`src/sync/alignmentRemote.ts` — so a client off the
 * tailnet still gets a span for any recording aligned once elsewhere), then
 * the tailnet-only MFA `/align` service. A fresh service result is written
 * back to the local cache and opportunistically pushed to Supabase.
 *
 * Returns `undefined` on any failure/unreachable case — never throws, since
 * an unavailable server is expected/ordinary here (docs/STATUS.md Phase 9,
 * Milestone 2b).
 *
 * Kept out of analysisApi.ts itself: tests mock `alignAudio` via
 * `vi.mock('../src/lib/analysisApi', ...)`, which only intercepts calls
 * made from *other* modules importing that export — a same-module call
 * (this function living inside analysisApi.ts and calling its neighbor
 * directly) would bypass the mock entirely. The Supabase tier is a dynamic
 * import so this leaf module keeps no static dependency on the sync layer.
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

  try {
    const { fetchRemoteAlignment } = await import('../sync/alignmentRemote');
    const remote = await fetchRemoteAlignment(id);
    if (remote) {
      await save(id, remote);
      return remote;
    }
  } catch {
    // Supabase not configured / offline — fall through to the service.
  }

  const fetched = await alignAudio(blob, transcript);
  if (fetched) {
    await save(id, fetched);
    void import('../sync/alignmentRemote')
      .then(({ uploadRemoteAlignment }) => uploadRemoteAlignment(id, fetched))
      .catch(() => {});
  }
  return fetched ?? undefined;
}
