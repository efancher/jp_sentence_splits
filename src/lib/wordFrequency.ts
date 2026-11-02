/**
 * Word-frequency bands for the word strength prior (`wordStrength.ts`
 * `frequencyBandPrior`). The data file `src/data/wordFrequency.json` is built
 * (`public/wordFrequency.json`) is built by `npm run build:word-frequency` from
 * the EDRDG JMdict priority tags and fetched on demand, so it never weighs on
 * the main bundle or the PWA precache.
 *
 * Format: expression → band, where a band is 1–48 (JMdict `nfNN`, 500 words
 * each, 1 most frequent). Words with only an unbanded priority tag are left
 * out to keep the file small (they get no prior). When a spelling's readings fall in different bands the value
 * is an object of reading → band instead, so homographs such as 日 do not
 * borrow each other's frequency.
 *
 * The data derives from JMdict (https://www.edrdg.org/jmdict/j_jmdict.html),
 * © the Electronic Dictionary Research and Development Group, used under
 * CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).
 */
export type FrequencyEntry = number | Record<string, number>;
export type WordFrequencyData = Record<string, FrequencyEntry>;

/** The band for a word as `frequencyBandPrior` takes it: a number, `'priority'`, or null when untagged. */
export function lookupWordBand(
  data: WordFrequencyData,
  expression: string,
  reading?: string,
): number | 'priority' | null {
  const entry = data[expression];
  if (entry === undefined) return null;
  const band = typeof entry === 'number' ? entry : reading !== undefined ? entry[reading] : undefined;
  if (band === undefined) {
    // A spelling with several readings but none matching: use its most frequent reading.
    const bands = typeof entry === 'number' ? [entry] : Object.values(entry);
    const numeric = bands.filter((value) => value > 0);
    if (numeric.length) return Math.min(...numeric);
    return 'priority';
  }
  return band === 0 ? 'priority' : band;
}

let cached: Promise<WordFrequencyData> | undefined;

/** How long a caller that only wants a small prior waits for the table before going without it. */
export const FREQUENCY_WAIT_MS = 1_500;
const FETCH_TIMEOUT_MS = 15_000;

/** Forgets the loaded table so the next load fetches again (tests). */
export function resetWordFrequencyCache(): void {
  cached = undefined;
}

/**
 * Loads the frequency data once per session. It is served from `public/` and
 * fetched on demand (not bundled or precached: ~780 KB). A failed or offline
 * load resolves to an empty table, meaning no prior, and is retried next time. The fetch is aborted after 15s so it can never hang a caller, and
 * `waitMs` caps how long this call itself waits: past it the caller proceeds
 * without a prior while the download carries on for the next call.
 */
export function loadWordFrequency(waitMs?: number): Promise<WordFrequencyData> {
  cached ??= fetch(`${import.meta.env.BASE_URL}wordFrequency.json`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
    .then((response) => {
      if (!response.ok) throw new Error(`wordFrequency.json: ${response.status}`);
      return response.json() as Promise<WordFrequencyData>;
    })
    .catch(() => {
      cached = undefined;
      return {} as WordFrequencyData;
    });
  if (waitMs === undefined) return cached;
  const table = cached;
  return new Promise<WordFrequencyData>((resolve) => {
    const timer = setTimeout(() => resolve({}), waitMs);
    void table.then((data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}
