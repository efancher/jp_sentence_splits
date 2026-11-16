// ---------------------------------------------------------------------------
// Planner pass-read layer (REPOSITORY_SPLIT_HANDOFF step 1): the whole-table
// reads, per-pass memoisation, cross-tap caches and step tracing that every
// other section of `repository.ts` leans on. This is deliberately the bottom
// layer: it imports only `database`, `plannerSnapshots` and the pure libs —
// never `repository.ts`. The module-level caches below must stay singletons;
// higher sections import them, they are never copied.
// ---------------------------------------------------------------------------

import type { Table } from 'dexie';

import { getMeaningBank } from '../../lib/meaningChoices';
import { withoutResetWalkthroughs } from '../../lib/sentenceLearning';
import { tileToolUnavailableReason } from '../../lib/earTiles';
import type {
  BookSentence,
  GlossDecision,
  Review,
  SentenceAudio,
  SentenceLearningEvent,
  SentenceVocabulary,
  StudyItem,
  VocabularyItem,
} from '../../domain/types';
import { getDb } from '../database';
import { loadSnapshot, onTableMutation } from '../plannerSnapshots';

/** Every learning event, loaded once per planning pass (shadowing and Read checks both scan it). */
export function readAllLearningEventsForPass(): Promise<SentenceLearningEvent[]> {
  return plannerShared('sentenceLearningEvents', ['sentenceLearningEvents'], () =>
    loadSnapshot(getDb(), 'sentenceLearningEvents', async () => withoutResetWalkthroughs(await getDb().sentenceLearningEvents.toArray())),
  );
}

/** Every book-sentence row, loaded once per planning pass (the planner needs it in two places). */
export function readAllBookSentencesForPass(): Promise<BookSentence[]> {
  return plannerShared('bookSentences', ['bookSentences'], () =>
    loadSnapshot(getDb(), 'bookSentences', () => getDb().bookSentences.toArray()),
  );
}

/**
 * Per-step wall-clock timings for the session planner's data gathering, logged
 * to the console as one table ("[planner timing]") so a slow "add time" tap can
 * be traced to the step responsible. Steps that run in parallel overlap, so
 * their durations don't sum to the total.
 */
let lastPlannerTiming = '';

/** The most recent `[planner timing]` report, for showing on devices without a console (Home page). */
export function getLastPlannerTiming(): string {
  return lastPlannerTiming;
}

/** Sub-step trace for the planning pass in flight (summed per label), so a slow top-level step can be broken down. */
let plannerTrace: Map<string, { ms: number; count: number; rows: number }> | null = null;

/** Times `work` into the active planner trace (no-op otherwise); `rowsOf` records how many rows it returned. */
export async function traceStep<T>(label: string, work: () => PromiseLike<T>, rowsOf?: (value: T) => number): Promise<T> {
  const begin = performance.now();
  const value = await work();
  if (plannerTrace) {
    const entry = plannerTrace.get(label) ?? { ms: 0, count: 0, rows: 0 };
    entry.ms += performance.now() - begin;
    entry.count += 1;
    entry.rows += rowsOf ? rowsOf(value) : 0;
    plannerTrace.set(label, entry);
  }
  return value;
}

export const rowCount = (value: unknown[]): number => value.length;

/** Whole-table reads shared by the steps of one planning pass (cleared when the pass reports). */
let plannerPassMemo: Map<string, Promise<unknown>> | null = null;

/** Whether a planning pass is in flight (its per-pass memo and trace are active). */
export function plannerPassActive(): boolean {
  return plannerPassMemo !== null;
}

function memoForPlannerPass<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!plannerPassMemo) return load();
  const cached = plannerPassMemo.get(key);
  if (cached) return cached as Promise<T>;
  const pending = load();
  plannerPassMemo.set(key, pending);
  return pending;
}

/**
 * Tables whose whole-table reads the planner keeps between taps. Reading a table costs a row at a
 * time (0.3-0.5 ms each, more on a phone) and the planner needs the same big tables on every tap, so
 * a read is reused until a write to a table it depends on.
 */
const PLANNER_CACHE_TABLES = [
  'books',
  'bookSentences',
  'sentenceLearningEvents',
  'reviews',
  'studyItems',
  'sentenceVocabulary',
  'vocabularyItems',
  'sentenceAudio',
  'analyses',
  'sentences',
  'glossDecisions',
] as const;
export type PlannerCacheTable = (typeof PLANNER_CACHE_TABLES)[number];

/** Safety net on top of write invalidation: nothing planner-cached is trusted for longer than this. */
const PLANNER_CACHE_MAX_AGE_MS = 30 * 60_000;

interface PlannerCacheEntry {
  value: Promise<unknown>;
  deps: readonly PlannerCacheTable[];
  counts: number[];
  at: number;
}

const plannerCachesByDbName = new Map<string, { db: object; cache: Map<string, PlannerCacheEntry> }>();

/** > 0 while `warmPlannerReads` runs, so its reads land in the cross-pass cache too. */
let plannerWarming = 0;

/** Whether the cross-pass warming reads are in flight. */
export function plannerWarmingActive(): boolean {
  return plannerWarming > 0;
}

export function beginPlannerWarming(): void {
  plannerWarming += 1;
}

export function endPlannerWarming(): void {
  plannerWarming -= 1;
}

type TableCounter = { count(): Promise<number> };

// Dexie reports each committed write (including `clear()`); drop every cached read that depends on the
// table. Unlike table hooks this adds no read-before-write cost to bulk writes such as a sync pull.
onTableMutation((dbName, table) => {
  const entry = plannerCachesByDbName.get(dbName);
  if (!entry) return;
  for (const [key, cached] of entry.cache) {
    if ((cached.deps as readonly string[]).includes(table)) entry.cache.delete(key);
  }
});

function plannerCacheFor(db: ReturnType<typeof getDb>): Map<string, PlannerCacheEntry> {
  const existing = plannerCachesByDbName.get(db.name);
  if (existing && existing.db === db) return existing.cache;
  const cache = new Map<string, PlannerCacheEntry>();
  plannerCachesByDbName.set(db.name, { db, cache });
  return cache;
}

async function cachedPlannerRead<T>(
  key: string,
  deps: readonly PlannerCacheTable[],
  load: () => Promise<T>,
): Promise<T> {
  const db = getDb();
  const cache = plannerCacheFor(db);
  const counts = await Promise.all(deps.map((table) => (db[table] as unknown as TableCounter).count()));
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < PLANNER_CACHE_MAX_AGE_MS && hit.counts.every((count, i) => count === counts[i])) {
    return hit.value as Promise<T>;
  }
  const value = load();
  const entry: PlannerCacheEntry = { value, deps, counts, at: Date.now() };
  cache.set(key, entry);
  value.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });
  return value;
}

/** Tests only: forget every in-memory cross-tap read so the next pass reads storage (snapshots or tables). */
export function resetPlannerReadCachesForTests(): void {
  plannerCachesByDbName.clear();
}

/**
 * Ends a planning pass: the per-pass memo and trace must never outlive the pass
 * (a failed pass would leave stale reads behind).
 */
export function endPlannerPass(): void {
  plannerTrace = null;
  plannerPassMemo = null;
}

/**
 * A whole-table read for the planner: shared within a pass and kept between passes (and by
 * `warmPlannerReads`). Anywhere else it is a plain read, so other screens never see cached data.
 */
export function plannerShared<T>(key: string, deps: readonly PlannerCacheTable[], load: () => Promise<T>): Promise<T> {
  if (plannerPassMemo) return memoForPlannerPass(key, () => cachedPlannerRead(key, deps, load));
  if (plannerWarming > 0) return cachedPlannerRead(key, deps, load);
  return load();
}

/**
 * Above this many ids, `where(...).anyOf(ids)` costs more than reading the whole table once:
 * Dexie issues one index lookup per id, and each is slow on a phone (a 4,000-id lookup took
 * ~38 s while a full scan of the same table takes 1-2 s).
 */
export const ANY_OF_SCAN_THRESHOLD = 40;

/**
 * For the small, blob-free tables the Reader joins (a few thousand rows): above this many keys one
 * `toArray()` beats `anyOf`, whose per-key lookups all wait in IndexedDB's queue. A 2026-11-07 iPhone
 * report spent 12-29 s in ~170 such lookups over tables of 1-2.5k rows, while a one-request `bulkGet`
 * on the same data took under 100 ms. Never use it on a table whose rows carry Blobs.
 */
export const SMALL_TABLE_ANY_OF_LIMIT = 6;

/**
 * The clips for `sentenceIds`, Blobs included. `anyOf` costs one queued lookup per id, which scales with the
 * episode: ~0.2-0.9 s per id on the iPhone that reported 20-sentence chapters taking 20 s, so a 380-sentence
 * episode would take minutes. Past a few ids this walks the `sentenceId` index once (keys only, no Blobs
 * read) and fetches just the wanted rows by primary key, which stays flat as the episode grows.
 */
export async function readSentenceAudioForSentences(sentenceIds: readonly string[]): Promise<SentenceAudio[]> {
  if (sentenceIds.length === 0) return [];
  const table = getDb().sentenceAudio;
  if (sentenceIds.length <= SMALL_TABLE_ANY_OF_LIMIT) return table.where('sentenceId').anyOf(sentenceIds as string[]).toArray();
  const wanted = new Set(sentenceIds);
  const clipIds: string[] = [];
  await table.orderBy('sentenceId').eachKey((sentenceId, cursor) => {
    if (wanted.has(sentenceId as string)) clipIds.push(cursor.primaryKey);
  });
  return (await table.bulkGet(clipIds)).filter((clip): clip is SentenceAudio => Boolean(clip));
}

/** Rows of a small table whose `index` value is in `keys`: `anyOf` for a few keys, one table read otherwise. */
export async function readRowsByKeys<T, TInsert>(table: Table<T, string, TInsert>, index: keyof T & string, keys: readonly string[]): Promise<T[]> {
  if (keys.length === 0) return [];
  if (keys.length <= SMALL_TABLE_ANY_OF_LIMIT) return table.where(index).anyOf(keys as string[]).toArray();
  const wanted = new Set(keys);
  return (await table.toArray()).filter((row) => wanted.has(row[index] as string));
}

/** Every sentence id that has a clip. The index scan costs a row per clip (about 1 s for ~4,000 on a phone). */
export function allAudioSentenceIds(): Promise<string[]> {
  return plannerShared(
    'audioSentenceIds',
    ['sentenceAudio'],
    () =>
      // A plain key cursor, de-duplicated here: `uniqueKeys()` opens a `nextunique` cursor, which
      // Playwright's WebKit rejects ("Unable to open cursor"), so it is avoided for portability.
      loadSnapshot(getDb(), 'audioSentenceIds', async () => [
        ...new Set((await getDb().sentenceAudio.orderBy('sentenceId').keys()) as string[]),
      ]),
  );
}

/** Every sentence-vocabulary link (a small table), shared like the other planner scans. */
export function readAllSentenceVocabularyForPass(): Promise<SentenceVocabulary[]> {
  return plannerShared('sentenceVocabulary', ['sentenceVocabulary'], () =>
    loadSnapshot(getDb(), 'sentenceVocabulary', () => getDb().sentenceVocabulary.toArray()),
  );
}

/**
 * Which of `sentenceIds` have a recorded clip. Reads only the `sentenceId` index:
 * `sentenceAudio` rows carry the audio Blob, so `toArray()` would load every clip
 * just to read an id (seconds on a phone).
 */
export async function sentenceIdsWithAudioClip(sentenceIds: string[]): Promise<Set<string>> {
  const table = getDb().sentenceAudio;
  if (sentenceIds.length <= ANY_OF_SCAN_THRESHOLD && !plannerPassMemo) {
    return new Set((await table.where('sentenceId').anyOf(sentenceIds).keys()) as string[]);
  }
  const wanted = new Set(sentenceIds);
  return new Set((await allAudioSentenceIds()).filter((id) => wanted.has(id)));
}

export async function learningEventsForSentences(sentenceIds: string[]): Promise<SentenceLearningEvent[]> {
  if (sentenceIds.length <= SMALL_TABLE_ANY_OF_LIMIT) {
    return withoutResetWalkthroughs(await getDb().sentenceLearningEvents.where('sentenceId').anyOf(sentenceIds).toArray());
  }
  const wanted = new Set(sentenceIds);
  return (await readAllLearningEventsForPass()).filter((event) => wanted.has(event.sentenceId));
}

export async function bookSentencesForSentences(sentenceIds: string[]): Promise<BookSentence[]> {
  if (sentenceIds.length <= SMALL_TABLE_ANY_OF_LIMIT) {
    return getDb().bookSentences.where('sentenceId').anyOf(sentenceIds).toArray();
  }
  const wanted = new Set(sentenceIds);
  return (await readAllBookSentencesForPass()).filter((row) => wanted.has(row.sentenceId));
}

/** Every study item, loaded once per planning pass (and from a packed snapshot between launches). */
export function readAllStudyItemsForPass(): Promise<StudyItem[]> {
  return plannerShared('studyItems', ['studyItems'], () =>
    loadSnapshot(getDb(), 'studyItems', () => getDb().studyItems.toArray()),
  );
}

/** Every sentence-subject study item. */
export async function readSentenceStudyItemsForPass(): Promise<StudyItem[]> {
  return (await readAllStudyItemsForPass()).filter((item) => item.subjectType === 'sentence');
}

/** Sentence ids whose analysis has a usable comprehension check (the sequential-mode gate); derived, stored packed. */
export async function readUsableCheckSentenceIdsForPass(): Promise<Set<string>> {
  const ids = await plannerShared('usableChecks', ['analyses'], () =>
    loadSnapshot(getDb(), 'usableCheckSentenceIds', async () =>
      (await getDb().analyses.toArray())
        .filter((analysis) => (getMeaningBank(analysis.comprehensionCheck)?.distractors.length ?? 0) > 0)
        .map((analysis) => analysis.sentenceId),
    ),
  );
  return new Set(ids);
}

export interface TileEligibility {
  id: string;
  tiles: boolean;
  dictate: boolean;
}

/** Ear tiles / Dictation eligibility per sentence (only sentences where either tool can open); derived from the sentence text. */
export async function readTileEligibilityForPass(): Promise<Map<string, TileEligibility>> {
  const rows = await plannerShared('tileEligibility', ['sentences'], () =>
    loadSnapshot(getDb(), 'tileEligibility', async () =>
      (await getDb().sentences.toArray()).flatMap((sentence): TileEligibility[] => {
        const tiles = tileToolUnavailableReason(sentence, 'tiles', true) === null;
        const dictate = tileToolUnavailableReason(sentence, 'dictate', true) === null;
        return tiles || dictate ? [{ id: sentence.id, tiles, dictate }] : [];
      }),
    ),
  );
  return new Map(rows.map((row) => [row.id, row]));
}

/** Every gloss decision, from the packed snapshot when valid. */
export function readAllGlossDecisionsForPass(): Promise<GlossDecision[]> {
  return plannerShared('glossDecisions', ['glossDecisions'], () =>
    loadSnapshot(getDb(), 'glossDecisions', () => getDb().glossDecisions.toArray()),
  );
}

/** Every vocabulary item, from the packed snapshot when valid. */
export function readAllVocabularyItemsForPass(): Promise<VocabularyItem[]> {
  return plannerShared('vocabularyItems', ['vocabularyItems'], () =>
    loadSnapshot(getDb(), 'vocabularyItems', () => getDb().vocabularyItems.toArray()),
  );
}

export async function reviewsForStudyItems(studyItemIds: string[]): Promise<Review[]> {
  // Each id is its own index lookup (~2 ms on a phone); inside a pass the full table is read once and shared.
  if (studyItemIds.length <= (plannerPassMemo ? 3 : ANY_OF_SCAN_THRESHOLD)) {
    return getDb().reviews.where('studyItemId').anyOf(studyItemIds).toArray();
  }
  const wanted = new Set(studyItemIds);
  const all = await plannerShared('reviews', ['reviews'], () =>
    loadSnapshot(getDb(), 'reviews', () => getDb().reviews.toArray()),
  );
  return all.filter((review) => wanted.has(review.studyItemId));
}

export function createPlannerTimer() {
  const started = performance.now();
  const rows: { step: string; ms: number }[] = [];
  plannerTrace = new Map();
  plannerPassMemo = new Map();
  // Steps run strictly one after another: on a phone, IndexedDB does not overlap them, and a contended
  // pass measured about 17 s slower than the same work run serially (2026-11-04).
  let chain: Promise<void> = Promise.resolve();
  return {
    async time<T>(step: string, work: () => Promise<T>): Promise<T> {
      const previous = chain;
      let release: () => void = () => {};
      chain = new Promise<void>((resolve) => (release = resolve));
      await previous;
      const begin = performance.now();
      try {
        return await work();
      } finally {
        rows.push({ step, ms: Math.round(performance.now() - begin) });
        release();
      }
    },
    report() {
      const total = Math.round(performance.now() - started);
      const text =
        `getSessionPlannerInput ${total} ms\n` +
        [...rows].sort((a, b) => b.ms - a.ms).map((row) => `${String(row.ms).padStart(6)} ms  ${row.step}`).join('\n');
      const trace = [...(plannerTrace ?? [])]
        .sort((a, b) => b[1].ms - a[1].ms)
        .map(
          ([label, entry]) =>
            `${String(Math.round(entry.ms)).padStart(6)} ms  · ${label} ×${entry.count}${entry.rows ? ` (${entry.rows} rows)` : ''}`,
        )
        .join('\n');
      plannerTrace = null;
      plannerPassMemo = null;
      const full = trace ? `${text}\n--- sub-steps (overlap with the above) ---\n${trace}` : text;
      lastPlannerTiming = full;
      console.info(`[planner timing] ${full}`);
    },
  };
}
