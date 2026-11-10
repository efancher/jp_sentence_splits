import { buildKanjiumPitchLookup, type KanjiumPitchLookup } from './kanjiumPitchLookup';

// Browser-only (uses `import.meta.env`), kept apart from the pure lookup so scripts can import that.
let cached: Promise<KanjiumPitchLookup | null> | undefined;
const FETCH_TIMEOUT_MS = 15_000;

/** Forgets the loaded table so the next load fetches again (tests). */
export function resetKanjiumPitchCache(): void {
  cached = undefined;
}

/**
 * Loads the table once per session (served from `public/`, fetched on demand, ~4 MB raw). Offline or failed
 * loads resolve to `null` (no extra marks) and are retried next time.
 */
export function loadKanjiumPitchLookup(): Promise<KanjiumPitchLookup | null> {
  cached ??= fetch(`${import.meta.env.BASE_URL}kanjiumPitch.json`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
    .then((response) => {
      if (!response.ok) throw new Error(`kanjiumPitch.json: ${response.status}`);
      return response.json() as Promise<Record<string, string>>;
    })
    .then(buildKanjiumPitchLookup)
    .catch(() => {
      cached = undefined;
      return null;
    });
  return cached;
}
