import Dexie from 'dexie';

import type { PlannerSnapshotRow } from '../domain/types';
import type { GlossbookDatabase } from './database';

/**
 * Packed, local-only copies of the whole-table reads the session planner needs on every tap.
 *
 * IndexedDB charges per row read (roughly 0.3-0.5 ms each, more on a phone) however small the
 * row, so reading ~4,500 `bookSentences` rows costs seconds. A snapshot stores the same records
 * as a few large rows, which reads in a few milliseconds. Nothing here changes what the planner
 * sees: a snapshot is the exact array a plain table scan would return, trusted only while no
 * table it depends on has been written since it was built. Otherwise the caller falls back to the
 * scan and a fresh snapshot is saved in the background. The table is never synced, backed up, or
 * read by anything but the planner, and can be deleted at any time.
 */

/** Bump to discard every stored snapshot (a snapshot's shape or builder changed). */
const SNAPSHOT_VERSION = 1;
/** Records per stored row: large enough to amortise the per-row cost, small enough to stay cheap to clone. */
const CHUNK_SIZE = 400;
/** Wait before saving, so the save never competes with the read that triggered it. */
let saveDelayMs = 1500;

/** Tests only: shorten (or zero) the wait before a background save. */
export function setSnapshotSaveDelayForTests(ms: number): void {
  saveDelayMs = ms;
}

/** Snapshot name -> the Dexie tables whose writes make it stale. */
export const SNAPSHOT_DEPS = {
  bookSentences: ['bookSentences'],
  sentenceLearningEvents: ['sentenceLearningEvents'],
  sentenceVocabulary: ['sentenceVocabulary'],
  reviews: ['reviews'],
  studyItems: ['studyItems'],
  vocabularyItems: ['vocabularyItems'],
  glossDecisions: ['glossDecisions'],
  /** Derived: sentence ids that have a recorded clip. */
  audioSentenceIds: ['sentenceAudio'],
  /** Derived: sentence ids whose analysis has a usable comprehension check. */
  usableCheckSentenceIds: ['analyses'],
  /** Derived: per-sentence Ear tiles / Dictation eligibility. */
  tileEligibility: ['sentences'],
} as const;

export type SnapshotName = keyof typeof SNAPSHOT_DEPS;

type TableCounter = { count(): Promise<number> };

// ---------------------------------------------------------------------------
// Mutation tracking
// ---------------------------------------------------------------------------

const mutationListeners = new Set<(dbName: string, table: string) => void>();
const tableEpochs = new Map<string, number>();
const memoryDirty = new Map<string, Set<string>>();

const epochKey = (dbName: string, table: string) => `${dbName}/${table}`;
const dirtyStorageKey = (dbName: string) => `satori.plannerSnapshots.dirty.${dbName}`;

function readStoredDirty(dbName: string): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(dirtyStorageKey(dbName));
    return new Set(raw ? raw.split(',').filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function writeStoredDirty(dbName: string, names: Set<string>): void {
  try {
    if (names.size === 0) globalThis.localStorage?.removeItem(dirtyStorageKey(dbName));
    else globalThis.localStorage?.setItem(dirtyStorageKey(dbName), [...names].join(','));
  } catch {
    // Private mode / no storage: the in-memory flags and the row-count check still apply.
  }
}

function dirtyNames(dbName: string): Set<string> {
  const names = memoryDirty.get(dbName) ?? new Set<string>();
  for (const name of readStoredDirty(dbName)) names.add(name);
  memoryDirty.set(dbName, names);
  return names;
}

function markDirty(dbName: string, snapshots: SnapshotName[]): void {
  const names = dirtyNames(dbName);
  let changed = false;
  for (const name of snapshots) {
    if (!names.has(name)) {
      names.add(name);
      changed = true;
    }
  }
  // Persisted so a crash or reload before the rebuild never trusts a snapshot that writes have outdated.
  if (changed) writeStoredDirty(dbName, names);
}

function clearDirty(dbName: string, name: SnapshotName): void {
  const names = dirtyNames(dbName);
  if (names.delete(name)) writeStoredDirty(dbName, names);
}

function handleMutation(dbName: string, table: string): void {
  const key = epochKey(dbName, table);
  tableEpochs.set(key, (tableEpochs.get(key) ?? 0) + 1);
  const stale = (Object.keys(SNAPSHOT_DEPS) as SnapshotName[]).filter((name) =>
    (SNAPSHOT_DEPS[name] as readonly string[]).includes(table),
  );
  if (stale.length) markDirty(dbName, stale);
  for (const listener of mutationListeners) listener(dbName, table);
}

// Dexie reports every committed write (put, bulkPut, delete and clear alike) with keys such as
// `idb://<db>/<table>/<index>`, and, unlike table hooks, without making writes read rows first.
Dexie.on('storagemutated', (parts: Record<string, unknown>) => {
  const handled = new Set<string>();
  for (const key of Object.keys(parts)) {
    const match = /^idb:\/\/(.+?)\/([^/]+)\//.exec(key);
    if (!match) continue;
    const id = `${match[1]}/${match[2]}`;
    if (handled.has(id)) continue;
    handled.add(id);
    handleMutation(match[1]!, match[2]!);
  }
});

/** Called after every committed write to any table of any open database. */
export function onTableMutation(listener: (dbName: string, table: string) => void): () => void {
  mutationListeners.add(listener);
  return () => mutationListeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Snapshot read / build / save
// ---------------------------------------------------------------------------

function depsOf(name: SnapshotName): readonly string[] {
  return SNAPSHOT_DEPS[name];
}

function epochsFor(dbName: string, name: SnapshotName): number[] {
  return depsOf(name).map((table) => tableEpochs.get(epochKey(dbName, table)) ?? 0);
}

async function countsFor(db: GlossbookDatabase, name: SnapshotName): Promise<number[]> {
  return Promise.all(
    depsOf(name).map((table) => ((db as unknown as Record<string, TableCounter>)[table] as TableCounter).count()),
  );
}

const sameNumbers = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

async function readStoredSnapshot<T>(db: GlossbookDatabase, name: SnapshotName): Promise<T[] | null> {
  if (dirtyNames(db.name).has(name)) return null;
  try {
    const meta = await db.plannerSnapshots.get(`${name}#meta`);
    if (!meta || meta.version !== SNAPSHOT_VERSION || !meta.counts) return null;
    if (!sameNumbers(meta.counts, await countsFor(db, name))) return null;
    const stored = await db.plannerSnapshots.where('table').equals(name).toArray();
    const chunks = stored.filter((row) => row.chunk >= 0).sort((a, b) => a.chunk - b.chunk);
    const rows = chunks.flatMap((row) => row.rows as T[]);
    if (rows.length !== meta.rowCount) return null;
    // A write that landed while reading means the stored copy may already be out of date.
    return dirtyNames(db.name).has(name) ? null : rows;
  } catch {
    return null;
  }
}

let saveChain: Promise<void> = Promise.resolve();

function scheduleSave<T>(
  db: GlossbookDatabase,
  name: SnapshotName,
  rows: T[],
  epochsAtStart: number[],
  countsAtStart: number[],
): void {
  saveChain = saveChain
    .then(() => new Promise<void>((resolve) => setTimeout(resolve, saveDelayMs)))
    .then(async () => {
      // Written to since the build began: the rows may be stale, so keep this snapshot dirty.
      if (!sameNumbers(epochsAtStart, epochsFor(db.name, name))) return;
      const packed: PlannerSnapshotRow[] = [];
      for (let start = 0, chunk = 0; start < rows.length; start += CHUNK_SIZE, chunk += 1) {
        packed.push({ id: `${name}#${chunk}`, table: name, chunk, rows: rows.slice(start, start + CHUNK_SIZE) });
      }
      packed.push({
        id: `${name}#meta`,
        table: name,
        chunk: -1,
        rows: [],
        version: SNAPSHOT_VERSION,
        counts: countsAtStart,
        rowCount: rows.length,
        savedAt: new Date().toISOString(),
      });
      await db.transaction('rw', db.plannerSnapshots, async () => {
        await db.plannerSnapshots.where('table').equals(name).delete();
        await db.plannerSnapshots.bulkPut(packed);
      });
      if (sameNumbers(epochsAtStart, epochsFor(db.name, name))) clearDirty(db.name, name);
    })
    .catch(() => {
      // Best effort: the next read simply rebuilds.
    });
}

const inFlight = new Map<string, Promise<unknown>>();

/**
 * The rows `build()` would return, from the stored snapshot when it is still valid. A rebuilt
 * result is saved in the background for the next launch. `build` must be a pure read of the
 * tables listed for `name` in SNAPSHOT_DEPS.
 */
export function loadSnapshot<T>(db: GlossbookDatabase, name: SnapshotName, build: () => Promise<T[]>): Promise<T[]> {
  const key = `${db.name}/${name}`;
  const running = inFlight.get(key);
  if (running) return running as Promise<T[]>;
  const run = (async () => {
    const stored = await readStoredSnapshot<T>(db, name);
    if (stored) return stored;
    const epochsAtStart = epochsFor(db.name, name);
    const countsAtStart = await countsFor(db, name);
    const rows = await build();
    scheduleSave(db, name, rows, epochsAtStart, countsAtStart);
    return rows;
  })();
  inFlight.set(key, run);
  const clear = () => {
    if (inFlight.get(key) === run) inFlight.delete(key);
  };
  run.then(clear, clear);
  return run;
}

/** Deletes every stored snapshot of this database (tests, and a manual "rebuild" if ever needed). */
export async function clearPlannerSnapshots(db: GlossbookDatabase): Promise<void> {
  await db.plannerSnapshots.clear();
  const names = dirtyNames(db.name);
  for (const name of Object.keys(SNAPSHOT_DEPS) as SnapshotName[]) names.add(name);
  writeStoredDirty(db.name, names);
}

/** Resolves once queued background saves have finished (tests). */
export function flushPlannerSnapshotSaves(): Promise<void> {
  return saveChain;
}
