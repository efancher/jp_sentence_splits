import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { strFromU8, unzipSync } from 'fflate';

// Pinned jmdict-simplified eng release (scriptin/jmdict-simplified), matching
// the version already used by ~/projects/anki/jmdict_pos.py.
const JMDICT_ENG_ZIP_URL =
  'https://github.com/scriptin/jmdict-simplified/releases/download/' +
  '3.6.2%2B20260511143416/jmdict-eng-3.6.2+20260511143416.json.zip';

const DEFAULT_CACHE_PATH = new URL('../.cache/jmdict-eng.json', import.meta.url).pathname;
const MAX_CANDIDATES_PER_EXPRESSION = 4;

interface JmdictGloss {
  lang?: string;
  text: string;
}

interface JmdictSense {
  partOfSpeech?: string[];
  gloss?: JmdictGloss[];
}

interface JmdictKanji {
  text: string;
  common?: boolean;
}

interface JmdictKana {
  text: string;
  common?: boolean;
  appliesToKanji?: string[];
}

export interface JmdictEntry {
  id: string;
  kanji?: JmdictKanji[];
  kana?: JmdictKana[];
  sense?: JmdictSense[];
}

export interface JmdictFile {
  words: JmdictEntry[];
}

/**
 * Coarse part-of-speech class used only to break homophone/polysemy ties in
 * `lookupJmdict` against the fugashi POS the caller already has. Not a full
 * grammar taxonomy — just enough to tell "the verb する" from "the noun 為
 * (bamboo screen)" etc.
 */
export type PosClass = 'noun' | 'verb' | 'adj-i' | 'adj-na' | 'adv';

/** JMDict POS tags (v5r, adj-i, n, ...) -> every PosClass they imply. */
export function jmdictPosClasses(pos: string): PosClass[] {
  const tags = pos
    .split(/[,;]\s*/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  const out = new Set<PosClass>();
  for (const tag of tags) {
    if (tag === 'adj-i' || tag === 'adj-ix') out.add('adj-i');
    else if (tag === 'adj-na') out.add('adj-na');
    else if (/^v(1|5[a-z]*|k|z|s|s-[is]|n|r|t|i)$/.test(tag) || tag === 'vs') out.add('verb');
    else if (tag === 'n' || tag.startsWith('n-') || tag === 'pn' || tag === 'num') out.add('noun');
    else if (tag === 'adv' || tag === 'adv-to') out.add('adv');
  }
  return [...out];
}

/**
 * fugashi/UniDic POS string ("動詞/一般", "名詞/固有名詞", "形状詞/一般") ->
 * PosClass. UniDic tags na-adjectives as 形状詞. Returns null for anything
 * that can't disambiguate a content-word lookup (particles, aux, symbols).
 */
export function japanesePosToJmdictClass(pos: string): PosClass | null {
  const major = (pos.split('/')[0] ?? '').trim();
  switch (major) {
    case '名詞':
    case '代名詞':
    case '数詞':
      return 'noun';
    case '動詞':
      return 'verb';
    case '形容詞':
      return 'adj-i';
    case '形状詞':
    case '形容動詞':
      return 'adj-na';
    case '副詞':
      return 'adv';
    default:
      return null;
  }
}

/**
 * Best-effort PosClass from whatever POS string a caller has: a fugashi/UniDic
 * tag ("動詞/一般"), or a JMDict tag list from an existing vocabulary row
 * ("v5r,vt", "n,vs"). Returns the first class for the JMDict-tag case.
 */
export function resolvePosClass(pos: string | null | undefined): PosClass | null {
  if (!pos?.trim()) return null;
  return japanesePosToJmdictClass(pos) ?? jmdictPosClasses(pos)[0] ?? null;
}

export interface GlossEntry {
  expression: string;
  reading: string;
  gloss: string;
  pos: string;
  posClasses: PosClass[];
  common: boolean;
  entryId: string;
}

export interface JmdictIndex {
  /** All candidates per `expression|reading`, common-first. */
  byKey: Map<string, GlossEntry[]>;
  /** All candidates per expression, common-first. */
  byExpression: Map<string, GlossEntry[]>;
}

function firstEnglishGloss(entry: JmdictEntry): string | null {
  for (const sense of entry.sense ?? []) {
    for (const gloss of sense.gloss ?? []) {
      if (!gloss.lang || gloss.lang === 'eng') return gloss.text;
    }
  }
  return null;
}

function posTags(entry: JmdictEntry): string {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const sense of entry.sense ?? []) {
    for (const tag of sense.partOfSpeech ?? []) {
      if (!seen.has(tag)) {
        seen.add(tag);
        tags.push(tag);
      }
    }
  }
  return tags.join(',');
}

function kanaAppliesTo(kana: JmdictKana, kanjiText: string): boolean {
  if (!kana.appliesToKanji || kana.appliesToKanji.length === 0) return true;
  return kana.appliesToKanji.includes('*') || kana.appliesToKanji.includes(kanjiText);
}

/** Pure parse: one entry -> its (expression, reading, gloss) pairs, respecting kana[].appliesToKanji restrictions. */
export function glossEntriesFromJmdictEntry(entry: JmdictEntry): GlossEntry[] {
  const gloss = firstEnglishGloss(entry);
  if (!gloss) return [];
  const pos = posTags(entry);
  const posClasses = jmdictPosClasses(pos);
  const kanjiList = entry.kanji ?? [];
  const kanaList = entry.kana ?? [];

  if (kanjiList.length === 0) {
    return kanaList.map((kana) => ({
      expression: kana.text,
      reading: kana.text,
      gloss,
      pos,
      posClasses,
      common: Boolean(kana.common),
      entryId: entry.id,
    }));
  }

  const results: GlossEntry[] = [];
  for (const kanji of kanjiList) {
    const applicable = kanaList.filter((kana) => kanaAppliesTo(kana, kanji.text));
    const kanaSource = applicable.length ? applicable : kanaList;
    for (const kana of kanaSource) {
      results.push({
        expression: kanji.text,
        reading: kana.text,
        gloss,
        pos,
        posClasses,
        common: Boolean(kanji.common || kana.common),
        entryId: entry.id,
      });
    }
  }
  // Also index by kana-only expression: many words with kanji forms are
  // still frequently written (and lemmatized by the tokenizer) in kana —
  // e.g. みんな/皆, たつ/経つ — and would otherwise never resolve since the
  // loop above only keys entries by kanji.text.
  for (const kana of kanaList) {
    results.push({
      expression: kana.text,
      reading: kana.text,
      gloss,
      pos,
      posClasses,
      common: Boolean(kana.common),
      entryId: entry.id,
    });
  }
  return results;
}

/**
 * True when `candidates` span 2+ distinct JMDict entries (different words,
 * not just different kanji/kana spellings of the same one) that are each
 * marked common — e.g. たつ collides 経つ "to pass (of time)", 立つ "to
 * stand", 絶つ "to sever", etc. Picking any one of those with confidence
 * would be a guess dressed up as a match, worse than surfacing no gloss —
 * this is especially true for kana-only lookups (this codebase's tokenizer
 * frequently lemmatizes to kana), which is exactly where JMDict's dense
 * homophone clusters live.
 */
function isGenuinelyAmbiguous(candidates: GlossEntry[]): boolean {
  const distinctCommonEntries = new Set(
    candidates.filter((c) => c.common).map((c) => c.entryId),
  );
  return distinctCommonEntries.size > 1;
}

function commonFirstShortestGloss(a: GlossEntry, b: GlossEntry): number {
  if (a.common !== b.common) return a.common ? -1 : 1;
  return a.gloss.length - b.gloss.length;
}

function dedupeSortCap(candidates: GlossEntry[]): GlossEntry[] {
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    const key = `${c.entryId}|${c.gloss}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort(commonFirstShortestGloss);
  unique.length = Math.min(unique.length, MAX_CANDIDATES_PER_EXPRESSION);
  return unique;
}

/**
 * Pure parse: the full JMDict file -> exact-key and by-expression lookup
 * indexes. Unlike the earlier version, genuinely-ambiguous entries are *kept*
 * in both maps (common-first, capped) — `lookupJmdict` decides whether a
 * caller-supplied POS resolves the ambiguity, and only falls back to
 * dropping the match when it can't.
 */
export function buildJmdictIndex(file: JmdictFile): JmdictIndex {
  const byKey = new Map<string, GlossEntry[]>();
  const byExpression = new Map<string, GlossEntry[]>();
  const push = (map: Map<string, GlossEntry[]>, key: string, value: GlossEntry) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };

  for (const entry of file.words) {
    for (const glossEntry of glossEntriesFromJmdictEntry(entry)) {
      push(byKey, `${glossEntry.expression}|${glossEntry.reading}`, glossEntry);
      push(byExpression, glossEntry.expression, glossEntry);
    }
  }

  for (const [key, candidates] of byKey) byKey.set(key, dedupeSortCap(candidates));
  for (const [expression, candidates] of byExpression) {
    byExpression.set(expression, dedupeSortCap(candidates));
  }

  return { byKey, byExpression };
}

/**
 * Choose one gloss from a candidate list:
 * - single candidate -> take it;
 * - a caller POS that narrows the list to exactly one PosClass match -> take it
 *   (or the common-first best if the survivors are all spelling variants of one
 *   word);
 * - otherwise the pre-POS behavior: the common-first best iff the list isn't
 *   `isGenuinelyAmbiguous`, else null (a guess dressed up as a match is worse
 *   than no gloss).
 */
function pickCandidate(candidates: GlossEntry[], posClass: PosClass | null): GlossEntry | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  if (posClass) {
    const byPos = candidates.filter((c) => c.posClasses.includes(posClass));
    if (byPos.length === 1) return byPos[0];
    if (byPos.length > 1 && !isGenuinelyAmbiguous(byPos)) return byPos[0];
  }

  if (isGenuinelyAmbiguous(candidates)) return null;
  return candidates[0];
}

/**
 * expression+reading exact match first, else the expression alone. `pos` is an
 * optional fugashi/UniDic POS string ("動詞/一般", "名詞/普通名詞", ...) used only
 * to break homophone/polysemy ties.
 */
export function lookupJmdict(
  index: JmdictIndex,
  expression: string,
  reading?: string,
  pos?: string,
): GlossEntry | null {
  const posClass = resolvePosClass(pos);
  if (reading) {
    const exact = pickCandidate(index.byKey.get(`${expression}|${reading}`) ?? [], posClass);
    if (exact) return exact;
  }
  return pickCandidate(index.byExpression.get(expression) ?? [], posClass);
}

async function downloadJmdictFile(): Promise<JmdictFile> {
  const response = await fetch(JMDICT_ENG_ZIP_URL);
  if (!response.ok) {
    throw new Error(`Failed to download JMDict release: ${response.status} ${response.statusText}`);
  }
  const zipBytes = new Uint8Array(await response.arrayBuffer());
  const unzipped = unzipSync(zipBytes);
  const jsonEntries = Object.entries(unzipped).filter(([name]) => name.endsWith('.json'));
  if (!jsonEntries.length) throw new Error('JMDict release zip contained no .json file.');
  const [, largestBytes] = jsonEntries.reduce((largest, current) =>
    current[1].length > largest[1].length ? current : largest,
  );
  return JSON.parse(strFromU8(largestBytes)) as JmdictFile;
}

/** Downloads and caches JMDict on first use; reads the local cache on subsequent calls. Never uploaded anywhere. */
export async function ensureJmdictFile(cachePath = DEFAULT_CACHE_PATH): Promise<JmdictFile> {
  try {
    const cached = await readFile(cachePath, 'utf8');
    return JSON.parse(cached) as JmdictFile;
  } catch {
    const file = await downloadJmdictFile();
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(file));
    return file;
  }
}
