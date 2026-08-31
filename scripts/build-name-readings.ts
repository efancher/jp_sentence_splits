/**
 * Build the compact proper-noun reading table the mining service consults
 * at tokenize time (`server/youtube-mining/app/name_readings.py`).
 *
 * fugashi/UniDic-lite has a name dictionary but fumbles distinctive given
 * names and surnames (水希 → みさん, ひし → ひろし …). Names are high-value
 * vocab and every re-mine of the same video pulls the same wrong reading,
 * so a dictionary second opinion at import time is worth a small shipped
 * file. JMnedict is the authority; we keep only the person-name entries
 * that have exactly one reading (`buildJmnedictIndex`'s `byExpression`
 * already filters ambiguous ones out — a bare 中田 shouldn't guess between
 * なかた and なかだ).
 *
 * Output: `server/youtube-mining/app/data/name_readings.json.gz`
 * (`{ "佐藤": "さとう", … }`, hiragana), ~1.5 MB gzipped / ~220k entries —
 * committed, so the box needs no 166 MB JMnedict download. Re-run this
 * (on a machine with the JMnedict cache) when JMnedict is bumped.
 *
 * Usage: npm run build:name-readings
 */
import { gzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { buildJmnedictIndex, ensureJmnedictFile } from './lib/jmnedict';
import { katakanaToHiragana } from './lib/kanjiumPitch';

const OUT_PATH = new URL(
  '../server/youtube-mining/app/data/name_readings.json.gz',
  import.meta.url,
).pathname;

const HAS_KANJI = /[㐀-鿿々]/;
const PERSON_LABEL = /surname|given name|female given|male given|full name of a person/;
const HIRAGANA_READING = /^[ぁ-ゖー]{2,12}$/;

async function main(): Promise<void> {
  const index = buildJmnedictIndex(await ensureJmnedictFile());

  const table: Record<string, string> = {};
  for (const [expression, entry] of index.byExpression) {
    const length = [...expression].length;
    if (!HAS_KANJI.test(expression) || length < 2 || length > 6) continue;
    const label = entry.gloss.match(/\(([^)]+)\)\s*$/)?.[1] ?? '';
    if (!PERSON_LABEL.test(label)) continue;
    const reading = katakanaToHiragana(entry.reading);
    if (!HIRAGANA_READING.test(reading)) continue;
    table[expression] = reading;
  }

  const json = JSON.stringify(table);
  const gz = gzipSync(Buffer.from(json), { level: 9 });
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, gz);
  console.log(
    `Wrote ${Object.keys(table).length} names → ${OUT_PATH} ` +
      `(${(gz.length / 1024 / 1024).toFixed(2)} MB gz)`,
  );
}

void main();
