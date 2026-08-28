import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { strFromU8, unzipSync } from 'fflate';

/**
 * JMnedict (EDRDG's proper-name dictionary) lookup — a last-resort companion
 * to scripts/lib/jmdict.ts for the one class of miss a bigger regular
 * dictionary can't fix: proper nouns (佐藤, 新宿, ...), which have zero JMDict
 * entries. Only consulted by the backfill scripts when JMDict returns nothing
 * and the fugashi POS is 名詞/固有名詞. Never shipped to the browser (same
 * Node-only, ~100 MB-cache constraint as jmdict.ts).
 *
 * Same pinned scriptin/jmdict-simplified release as jmdict.ts.
 */
const JMNEDICT_ZIP_URL =
  'https://github.com/scriptin/jmdict-simplified/releases/download/' +
  '3.6.2%2B20260511143416/jmnedict-all-3.6.2+20260511143416.json.zip';

const DEFAULT_CACHE_PATH = new URL('../.cache/jmnedict.json', import.meta.url).pathname;

interface JmnedictTranslationText {
  lang?: string;
  text: string;
}

interface JmnedictTranslation {
  type?: string[];
  translation?: JmnedictTranslationText[];
}

interface JmnedictKanji {
  text: string;
}

interface JmnedictKana {
  text: string;
  appliesToKanji?: string[];
}

export interface JmnedictEntry {
  id: string;
  kanji?: JmnedictKanji[];
  kana?: JmnedictKana[];
  translation?: JmnedictTranslation[];
}

export interface JmnedictFile {
  words: JmnedictEntry[];
}

export interface NameEntry {
  expression: string;
  reading: string;
  gloss: string;
  typePriority: number;
}

export interface JmnedictIndex {
  byKey: Map<string, NameEntry>;
  /** Only expressions with a single distinct reading — a bare-expression lookup
   * shouldn't guess between 佐藤=さとう and its rare さいう reading. */
  byExpression: Map<string, NameEntry>;
}

// When one expression|reading has several JMnedict entries (人 vs 地名 vs 会社),
// prefer the person reading — the tokenizer only tags 固有名詞 for words used as
// names in running dialogue, which are overwhelmingly people.
const NAME_TYPE_PRIORITY: Record<string, number> = {
  surname: 0,
  given: 0,
  person: 0,
  fem: 0,
  masc: 0,
  place: 1,
  station: 1,
  company: 2,
  organization: 2,
  product: 2,
  work: 2,
};

const NAME_TYPE_LABELS: Record<string, string> = {
  surname: 'surname',
  place: 'place name',
  given: 'given name',
  person: 'full name of a person',
  fem: 'female given name',
  masc: 'male given name',
  company: 'company name',
  organization: 'organization name',
  product: 'product name',
  work: 'work of art / literature / music',
  station: 'railway station',
  group: 'group',
  char: 'character',
  unclass: 'name',
  oth: 'name',
};

function bestType(types: string[] | undefined): string {
  if (!types?.length) return 'unclass';
  return [...types].sort(
    (a, b) => (NAME_TYPE_PRIORITY[a] ?? 3) - (NAME_TYPE_PRIORITY[b] ?? 3),
  )[0];
}

function firstEnglishName(entry: JmnedictEntry): { text: string; type: string } | null {
  for (const translation of entry.translation ?? []) {
    const english = (translation.translation ?? []).find((t) => !t.lang || t.lang === 'eng');
    if (!english?.text) continue;
    return { text: english.text, type: bestType(translation.type) };
  }
  return null;
}

/** "Satō" + "surname" -> "Satō (surname)". */
function formatNameGloss(text: string, type: string): string {
  const label = NAME_TYPE_LABELS[type] ?? 'name';
  return `${text} (${label})`;
}

function kanaAppliesTo(kana: JmnedictKana, kanjiText: string): boolean {
  if (!kana.appliesToKanji || kana.appliesToKanji.length === 0) return true;
  return kana.appliesToKanji.includes('*') || kana.appliesToKanji.includes(kanjiText);
}

/** Pure parse: JMnedict file -> exact-key and by-expression name indexes. */
export function buildJmnedictIndex(file: JmnedictFile): JmnedictIndex {
  const byKey = new Map<string, NameEntry>();
  const readingsByExpression = new Map<string, Set<string>>();

  for (const entry of file.words) {
    const name = firstEnglishName(entry);
    if (!name) continue;
    const gloss = formatNameGloss(name.text, name.type);
    const typePriority = NAME_TYPE_PRIORITY[name.type] ?? 3;
    const kanjiList = entry.kanji ?? [];
    const kanaList = entry.kana ?? [];
    const expressions = kanjiList.length ? kanjiList.map((k) => k.text) : kanaList.map((k) => k.text);

    for (const expression of expressions) {
      const readings = kanjiList.length
        ? kanaList.filter((k) => kanaAppliesTo(k, expression)).map((k) => k.text)
        : [expression];
      for (const reading of readings.length ? readings : [expression]) {
        const key = `${expression}|${reading}`;
        const existing = byKey.get(key);
        if (!existing || typePriority < existing.typePriority) {
          byKey.set(key, { expression, reading, gloss, typePriority });
        }
        const seen = readingsByExpression.get(expression) ?? new Set<string>();
        seen.add(reading);
        readingsByExpression.set(expression, seen);
      }
    }
  }

  const byExpression = new Map<string, NameEntry>();
  for (const [expression, readings] of readingsByExpression) {
    if (readings.size !== 1) continue;
    const [reading] = readings;
    const record = byKey.get(`${expression}|${reading}`);
    if (record) byExpression.set(expression, record);
  }

  return { byKey, byExpression };
}

/** expression+reading exact match first, else the expression alone. */
export function lookupJmnedict(
  index: JmnedictIndex,
  expression: string,
  reading?: string,
): NameEntry | null {
  if (reading) {
    const exact = index.byKey.get(`${expression}|${reading}`);
    if (exact) return exact;
  }
  return index.byExpression.get(expression) ?? null;
}

async function downloadJmnedictFile(): Promise<JmnedictFile> {
  const response = await fetch(JMNEDICT_ZIP_URL);
  if (!response.ok) {
    throw new Error(`Failed to download JMnedict release: ${response.status} ${response.statusText}`);
  }
  const zipBytes = new Uint8Array(await response.arrayBuffer());
  const unzipped = unzipSync(zipBytes);
  const jsonEntries = Object.entries(unzipped).filter(([name]) => name.endsWith('.json'));
  if (!jsonEntries.length) throw new Error('JMnedict release zip contained no .json file.');
  const [, largestBytes] = jsonEntries.reduce((largest, current) =>
    current[1].length > largest[1].length ? current : largest,
  );
  return JSON.parse(strFromU8(largestBytes)) as JmnedictFile;
}

/** Downloads and caches JMnedict on first use; reads the local cache after. Never uploaded anywhere. */
export async function ensureJmnedictFile(cachePath = DEFAULT_CACHE_PATH): Promise<JmnedictFile> {
  try {
    const cached = await readFile(cachePath, 'utf8');
    return JSON.parse(cached) as JmnedictFile;
  } catch {
    const file = await downloadJmnedictFile();
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(file));
    return file;
  }
}
