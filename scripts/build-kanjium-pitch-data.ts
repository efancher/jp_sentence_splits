/**
 * Writes public/kanjiumPitch.json from the local Kanjium Yomitan zip (see scripts/lib/kanjiumPitch.ts):
 * `{ "expression|hiraganaReading": "0" | "1,3" }`, keys sorted so regenerating gives a stable diff. The app
 * fetches it on demand (src/lib/kanjiumPitchLookup.ts; served from public/, not bundled or precached) to mark H/L pitch on words that have no vocabulary link.
 *
 * Usage: npm run build:kanjium-pitch-data
 */
import { writeFile } from 'node:fs/promises';
import { ensureKanjiumPitchIndex } from './lib/kanjiumPitch';

async function main(): Promise<void> {
  const index = await ensureKanjiumPitchIndex();
  const out: Record<string, string> = {};
  for (const key of [...index.keys()].sort()) out[key] = index.get(key)!.join(',');
  const target = new URL('../public/kanjiumPitch.json', import.meta.url);
  await writeFile(target, JSON.stringify(out) + '\n');
  console.log(`Wrote ${Object.keys(out).length} entries to public/kanjiumPitch.json`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
