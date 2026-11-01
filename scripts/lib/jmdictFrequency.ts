import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';

/**
 * General-language frequency from the raw EDRDG JMdict (CC BY-SA), which keeps
 * the `ke_pri` / `re_pri` priority tags that the jmdict-simplified release used
 * by `jmdict.ts` drops. The `nfNN` tags place a word in a 500-word band of the
 * Mainichi Shimbun frequency list (nf01 = most frequent). Words with only a
 * `news1/ichi1/spec1/gai1`-style tag have no band and map to `'priority'`.
 *
 * Local-only: downloaded to `scripts/.cache/` (gitignored), never uploaded.
 * `parseJmdictFrequency` is pure so it can be tested without the download.
 */
const JMDICT_E_GZ_URL = 'http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz';
const DEFAULT_CACHE_PATH = new URL('../.cache/JMdict_e.xml', import.meta.url).pathname;

export type FrequencyBand = number | 'priority';

/** Keys are `expression` and `expression|reading`; the more frequent band wins on collision. */
export type FrequencyIndex = Map<string, FrequencyBand>;

const ENTRY = /<entry>([\s\S]*?)<\/entry>/g;
const TAG = (name: string) => new RegExp(`<${name}>([^<]*)</${name}>`, 'g');
const ELEMENT = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g');
const PRIORITY_PREFIX = /^(news|ichi|spec|gai)[12]$/;

function betterBand(a: FrequencyBand | undefined, b: FrequencyBand): FrequencyBand {
  if (a === undefined) return b;
  if (typeof a === 'number' && typeof b === 'number') return Math.min(a, b);
  return typeof a === 'number' ? a : typeof b === 'number' ? b : 'priority';
}

function bandOf(tags: string[]): FrequencyBand | null {
  let band: FrequencyBand | null = null;
  for (const tag of tags) {
    const nf = /^nf(\d{2})$/.exec(tag);
    if (nf) band = betterBand(band ?? undefined, Number(nf[1]));
    else if (PRIORITY_PREFIX.test(tag)) band = betterBand(band ?? undefined, 'priority');
  }
  return band;
}

function textsOf(block: string, name: string): string[] {
  return [...block.matchAll(TAG(name))].map((match) => match[1]!);
}

export function parseJmdictFrequency(xml: string): FrequencyIndex {
  const index: FrequencyIndex = new Map();
  const put = (key: string, band: FrequencyBand) => index.set(key, betterBand(index.get(key), band));
  for (const entry of xml.matchAll(ENTRY)) {
    const body = entry[1]!;
    const kanji = [...body.matchAll(ELEMENT('k_ele'))].map((m) => ({
      text: textsOf(m[1]!, 'keb')[0],
      band: bandOf(textsOf(m[1]!, 'ke_pri')),
    }));
    const kana = [...body.matchAll(ELEMENT('r_ele'))].map((m) => ({
      text: textsOf(m[1]!, 'reb')[0],
      band: bandOf(textsOf(m[1]!, 're_pri')),
    }));
    for (const reading of kana) {
      if (!reading.text) continue;
      if (reading.band !== null) {
        put(reading.text, reading.band);
        put(`${reading.text}|${reading.text}`, reading.band);
      }
      for (const spelling of kanji) {
        if (!spelling.text) continue;
        // A priority tag marks the spelling/reading pairing it sits on; use the better of the two sides.
        const band = spelling.band ?? reading.band;
        if (band === null || band === undefined) continue;
        put(spelling.text, band);
        put(`${spelling.text}|${reading.text}`, band);
      }
    }
  }
  return index;
}

/** The frequency band for a word, preferring the exact expression+reading pair. */
export function lookupFrequency(index: FrequencyIndex, expression: string, reading?: string): FrequencyBand | null {
  return (reading ? index.get(`${expression}|${reading}`) : undefined) ?? index.get(expression) ?? null;
}

/** Downloads and caches the raw JMdict on first use; reads the local cache afterwards. */
export async function ensureFrequencyIndex(cachePath = DEFAULT_CACHE_PATH): Promise<FrequencyIndex> {
  let xml: string;
  try {
    xml = await readFile(cachePath, 'utf8');
  } catch {
    const response = await fetch(JMDICT_E_GZ_URL);
    if (!response.ok) throw new Error(`JMdict download failed: ${response.status}`);
    xml = gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8');
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, xml);
  }
  return parseJmdictFrequency(xml);
}
