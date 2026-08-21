import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

import { strFromU8, unzipSync } from 'fflate';

/**
 * Pitch-accent dictionary lookup, backing `scripts/backfill-pitch-accent.ts`
 * and (via `VocabularyItem.pitchAccentPositions`) the ground-truth
 * pitch-accent scoring in `src/lib/pitchAccentObservations.ts`.
 *
 * Data: the Kanjium pitch-accent dataset (github.com/mifunetoshiro/kanjium),
 * distributed in Yomitan/Yomichan dictionary format by
 * github.com/toasted-nutbread/yomichan-pitch-accent-dictionary. Already
 * downloaded and used by ~/projects/anki's `immersion_pitch.py`/`wk_decks.py`
 * (`load_yomitan_pitch`) — this module ports that loader's logic to
 * TypeScript. No verified stable public download URL, so this sources the
 * zip from that existing local copy rather than fetching one.
 */

const DEFAULT_SOURCE_PATH = join(homedir(), 'projects', 'anki', 'kanjium_pitch_accents.zip');
const DEFAULT_CACHE_PATH = new URL('../.cache/kanjium-pitch-accents.zip', import.meta.url).pathname;

const TERM_META_BANK_PATTERN = /^term_meta_bank_\d+\.json$/;

export interface YomitanPitchRow {
  term: string;
  reading: string;
  positions: number[];
}

/** Katakana (U+30A1-U+30F6) -> hiragana (U+3041-U+3096); anything else unchanged (e.g. the U+30FC long-vowel mark). */
export function katakanaToHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0x60),
  );
}

/** Pure parse: one Yomitan term_meta row -> its (term, reading, positions), or null if not a usable pitch entry. */
export function parseYomitanPitchRow(row: unknown): YomitanPitchRow | null {
  if (!Array.isArray(row) || row.length < 3) return null;
  const [term, metaType, payload] = row as [unknown, unknown, unknown];
  if (typeof term !== 'string' || metaType !== 'pitch') return null;
  if (!payload || typeof payload !== 'object') return null;
  const { reading, pitches } = payload as { reading?: unknown; pitches?: unknown };
  if (typeof reading !== 'string' || !Array.isArray(pitches)) return null;
  const positions: number[] = [];
  for (const pitch of pitches) {
    if (pitch && typeof pitch === 'object' && typeof (pitch as { position?: unknown }).position === 'number') {
      positions.push((pitch as { position: number }).position);
    }
  }
  if (!positions.length) return null;
  return { term, reading, positions };
}

/**
 * Pure parse: every row from every term_meta_bank_*.json file -> an
 * expression+reading (hiragana-normalized) lookup index, merging positions
 * when a key repeats across files (same de-dup-by-append behavior as
 * ~/projects/anki/wk_decks.py's `load_yomitan_pitch`).
 */
export function buildKanjiumPitchIndex(rows: unknown[]): Map<string, number[]> {
  const byKey = new Map<string, number[]>();
  for (const raw of rows) {
    const parsed = parseYomitanPitchRow(raw);
    if (!parsed) continue;
    const key = `${parsed.term}|${katakanaToHiragana(parsed.reading)}`;
    const existing = byKey.get(key);
    if (existing) {
      for (const position of parsed.positions) {
        if (!existing.includes(position)) existing.push(position);
      }
    } else {
      byKey.set(key, [...parsed.positions]);
    }
  }
  return byKey;
}

/** expression+reading exact match (both sides hiragana-normalized), or null. */
export function lookupKanjiumPitch(
  index: Map<string, number[]>,
  expression: string,
  reading: string,
): number[] | null {
  return index.get(`${expression}|${katakanaToHiragana(reading)}`) ?? null;
}

/** Unzips and extracts every term_meta_bank_*.json row (index.json/tag_bank_1.json are skipped — not pitch data). */
export function extractPitchRows(zipBytes: Uint8Array): unknown[] {
  const unzipped = unzipSync(zipBytes);
  const rows: unknown[] = [];
  for (const [name, bytes] of Object.entries(unzipped)) {
    if (!TERM_META_BANK_PATTERN.test(name)) continue;
    const parsed = JSON.parse(strFromU8(bytes));
    if (Array.isArray(parsed)) rows.push(...parsed);
  }
  return rows;
}

/** Caches the dictionary zip on first use (copied from the local anki repo checkout); reads the cache on subsequent calls. */
export async function ensureKanjiumPitchZip(
  cachePath = DEFAULT_CACHE_PATH,
  sourcePath = DEFAULT_SOURCE_PATH,
): Promise<Uint8Array> {
  try {
    return await readFile(cachePath);
  } catch {
    let bytes: Buffer;
    try {
      bytes = await readFile(sourcePath);
    } catch {
      throw new Error(
        `Kanjium pitch dictionary not found at ${sourcePath}. This backfill expects ` +
          'a local checkout of ~/projects/anki with kanjium_pitch_accents.zip present.',
      );
    }
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, bytes);
    return bytes;
  }
}

export async function ensureKanjiumPitchIndex(
  cachePath = DEFAULT_CACHE_PATH,
  sourcePath = DEFAULT_SOURCE_PATH,
): Promise<Map<string, number[]>> {
  const zipBytes = await ensureKanjiumPitchZip(cachePath, sourcePath);
  return buildKanjiumPitchIndex(extractPitchRows(zipBytes));
}
