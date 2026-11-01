/**
 * Builds `public/wordFrequency.json` (see `src/lib/wordFrequency.ts`) from the
 * raw EDRDG JMdict priority tags. Downloads and caches JMdict under
 * `scripts/.cache/` on first run; writes only that one file.
 *
 * Usage: npm run build:word-frequency
 */
import { mkdir, writeFile } from 'node:fs/promises';

import { ensureFrequencyIndex } from './lib/jmdictFrequency';

// Mirrors src/lib/wordFrequency.ts; not imported because that module needs Vite's `import.meta.env` types.
type FrequencyEntry = number | Record<string, number>;
type WordFrequencyData = Record<string, FrequencyEntry>;

const OUTPUT = new URL('../public/wordFrequency.json', import.meta.url).pathname;

async function main() {
  const index = await ensureFrequencyIndex();
  // Group `expression|reading` keys by expression; bare-expression keys are the best-of fallback.
  const byExpression = new Map<string, Map<string, number>>();
  for (const [key, band] of index) {
    const bar = key.indexOf('|');
    if (bar < 0) continue;
    const expression = key.slice(0, bar);
    const reading = key.slice(bar + 1);
    const readings = byExpression.get(expression) ?? new Map<string, number>();
    // Unbanded priority tags (news1, ichi1…) are dropped: they would double the file for a weak signal.
    if (band === 'priority') continue;
    readings.set(reading, band);
    byExpression.set(expression, readings);
  }
  const data: WordFrequencyData = {};
  for (const [expression, readings] of [...byExpression].sort((a, b) => a[0].localeCompare(b[0]))) {
    const bands = new Set(readings.values());
    const entry: FrequencyEntry =
      bands.size === 1 ? [...bands][0]! : Object.fromEntries([...readings].sort((a, b) => a[0].localeCompare(b[0])));
    data[expression] = entry;
  }
  await mkdir(new URL('../public/', import.meta.url).pathname, { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(data));
  console.log(`${Object.keys(data).length} expressions written to public/wordFrequency.json`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
