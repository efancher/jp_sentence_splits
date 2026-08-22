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

export interface GlossEntry {
  expression: string;
  reading: string;
  gloss: string;
  pos: string;
  common: boolean;
  entryId: string;
}

export interface JmdictIndex {
  byKey: Map<string, GlossEntry>;
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
  const kanjiList = entry.kanji ?? [];
  const kanaList = entry.kana ?? [];

  if (kanjiList.length === 0) {
    return kanaList.map((kana) => ({
      expression: kana.text,
      reading: kana.text,
      gloss,
      pos,
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
      common: Boolean(kana.common),
      entryId: entry.id,
    });
  }
  return results;
}

/**
 * Same "common first, then shortest gloss" preference used for both the
 * exact-key and by-expression indexes, so a homophone match doesn't depend
 * on which JMDict entry happened to be inserted first (file order is
 * otherwise arbitrary from this codebase's perspective).
 */
function isBetterCandidate(candidate: GlossEntry, existing: GlossEntry): boolean {
  if (candidate.common !== existing.common) return candidate.common;
  return candidate.gloss.length < existing.gloss.length;
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

/** Pure parse: the full JMDict file -> exact-key and by-expression lookup indexes. */
export function buildJmdictIndex(file: JmdictFile): JmdictIndex {
  const keyCandidates = new Map<string, GlossEntry[]>();
  const expressionCandidates = new Map<string, GlossEntry[]>();

  for (const entry of file.words) {
    for (const glossEntry of glossEntriesFromJmdictEntry(entry)) {
      const key = `${glossEntry.expression}|${glossEntry.reading}`;
      const keyList = keyCandidates.get(key);
      if (keyList) keyList.push(glossEntry);
      else keyCandidates.set(key, [glossEntry]);

      const list = expressionCandidates.get(glossEntry.expression);
      if (list) list.push(glossEntry);
      else expressionCandidates.set(glossEntry.expression, [glossEntry]);
    }
  }

  const byKey = new Map<string, GlossEntry>();
  for (const [key, candidates] of keyCandidates) {
    if (isGenuinelyAmbiguous(candidates)) continue;
    byKey.set(key, candidates.reduce((best, c) => (isBetterCandidate(c, best) ? c : best)));
  }

  const byExpression = new Map<string, GlossEntry[]>();
  for (const [expression, candidates] of expressionCandidates) {
    if (isGenuinelyAmbiguous(candidates)) continue;
    candidates.sort((a, b) => {
      if (a.common !== b.common) return a.common ? -1 : 1;
      return a.gloss.length - b.gloss.length;
    });
    candidates.length = Math.min(candidates.length, MAX_CANDIDATES_PER_EXPRESSION);
    byExpression.set(expression, candidates);
  }

  return { byKey, byExpression };
}

/** expression+reading exact match first, else the best (common-first) candidate for the expression alone. */
export function lookupJmdict(index: JmdictIndex, expression: string, reading?: string): GlossEntry | null {
  if (reading) {
    const exact = index.byKey.get(`${expression}|${reading}`);
    if (exact) return exact;
  }
  return index.byExpression.get(expression)?.[0] ?? null;
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
