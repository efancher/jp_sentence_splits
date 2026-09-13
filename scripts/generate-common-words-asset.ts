/**
 * One-time (re-run when JMDict updates) generator: flattens every
 * spelling variant JMDict marks `common: true` — kanji and kana forms both —
 * into a plain JSON array, for the Python mining service's difficulty-
 * screening checkpoint (server/youtube-mining/app/common_words.py).
 *
 * JMDict data only lives on the Node side (scripts/lib/jmdict.ts); Japanese
 * tokenization (and therefore any per-lemma difficulty scoring) only runs in
 * the Python service (fugashi/UniDic). This script is the one place the
 * "common" flag crosses that boundary, so the difficulty scorer stays one
 * shared function instead of a copy per mining pipeline (see
 * docs/ROADMAP.md, "Podcast mining" item 5).
 *
 * Usage: npx tsx scripts/generate-common-words-asset.ts
 */
import { writeFile } from 'node:fs/promises';

import { ensureJmdictFile } from './lib/jmdict';

const OUTPUT_PATH = new URL(
  '../server/youtube-mining/app/data/common_words.json',
  import.meta.url,
).pathname;

async function main() {
  console.log('Loading JMDict (downloads + caches on first run)...');
  const file = await ensureJmdictFile();

  const common = new Set<string>();
  for (const entry of file.words) {
    for (const kanji of entry.kanji ?? []) {
      if (kanji.common) common.add(kanji.text);
    }
    for (const kana of entry.kana ?? []) {
      if (kana.common) common.add(kana.text);
    }
  }

  const sorted = [...common].sort();
  await writeFile(OUTPUT_PATH, JSON.stringify(sorted));
  console.log(`Wrote ${sorted.length} common words to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
