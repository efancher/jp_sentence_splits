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
/** Clips whose stored alignment length differs from the audio by more than this were re-cut after aligning. */
export const ALIGNMENT_DURATION_TOLERANCE_SECONDS = 0.15;

/** Audio length from its own metadata; undefined where media metadata isn't available (tests, timeouts). */
export function blobDurationSeconds(blob: Blob, timeoutMs = 3000): Promise<number | undefined> {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return Promise.resolve(undefined);
  if (/jsdom/i.test(globalThis.navigator?.userAgent ?? '')) return Promise.resolve(undefined); // never loads media
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(blob);
    const done = (value: number | undefined) => {
      clearTimeout(timer);
      audio.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(undefined), timeoutMs);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined);
    audio.onerror = () => done(undefined);
    audio.src = url;
  });
}

/**
 * A cached alignment is only valid for the audio it was computed on. Re-cutting or trimming a
 * clip keeps its id, so a stale result times every word against the wrong stretch of sound
 * (pitch then gets measured on the neighbouring syllable). Unknown duration → trust the cache.
 */
export function alignmentMatchesAudio(result: AlignmentResult, audioSeconds: number | undefined): boolean {
  if (audioSeconds === undefined || !(result.durationSeconds > 0)) return true;
  return Math.abs(result.durationSeconds - audioSeconds) <= ALIGNMENT_DURATION_TOLERANCE_SECONDS;
}

export async function loadOrComputeAlignment(
  id: string,
  blob: Blob,
  transcript: string,
  get: (id: string) => Promise<AlignmentResult | undefined>,
  save: (id: string, result: AlignmentResult) => Promise<void>,
): Promise<AlignmentResult | undefined> {
  let audioSeconds: Promise<number | undefined> | undefined;
  const usable = async (result: AlignmentResult) => {
    audioSeconds ??= blobDurationSeconds(blob);
    return alignmentMatchesAudio(result, await audioSeconds);
  };

  const cached = await get(id);
  if (cached && (await usable(cached))) return cached;

  try {
    const { fetchRemoteAlignment } = await import('../sync/alignmentRemote');
    const remote = await fetchRemoteAlignment(id);
    if (remote && (await usable(remote))) {
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
