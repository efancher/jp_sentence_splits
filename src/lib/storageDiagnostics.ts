// What the device's IndexedDB looks like, for slow-page reports: a one-row read's round trip says whether the
// queue is backed up right now, and table sizes say how much a slow query had to wade through.

import { getDb } from '../db/database';

/** The tables the Reader and review queries read most, so their sizes explain a slow step. */
const SIZED_TABLES = [
  'studyItems',
  'sentences',
  'bookSentences',
  'sentenceVocabulary',
  'vocabularyItems',
  'sentenceGrammar',
  'sentenceAudio',
  'sentenceLearningEvents',
  'syncQueue',
];

export interface StorageSnapshot {
  tableCounts: Record<string, number>;
  /** `navigator.storage.estimate()`, in MB; browsers may round or withhold it. */
  usageMb?: number;
  quotaMb?: number;
  /** Same 20 rows fetched three ways, so a report shows which access pattern this device is slow at. */
  lookupProbeMs?: { anyOf: number; scan: number; bulkGet: number };
  takenAt: string;
  /** How long the snapshot itself took; counting a busy table is slow too. */
  tookMs: number;
}

async function timed(work: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await work();
  return Math.round(performance.now() - started);
}

/** 20 `sentenceVocabulary` rows by id via `where().anyOf()` (the Reader's old pattern), a whole-table read, and `bulkGet`. */
async function probeLookups(): Promise<StorageSnapshot['lookupProbeMs']> {
  const table = getDb().sentenceVocabulary;
  const sample = await table.limit(20).toArray();
  if (sample.length < 20) return undefined;
  const sentenceIds = [...new Set(sample.map((row) => row.sentenceId))];
  const ids = sample.map((row) => row.id);
  return {
    anyOf: await timed(() => table.where('sentenceId').anyOf(sentenceIds).toArray()),
    scan: await timed(() => table.toArray()),
    bulkGet: await timed(() => table.bulkGet(ids)),
  };
}

let snapshot: StorageSnapshot | undefined;
let refreshing: Promise<void> | undefined;

/** Round trip (ms) of one trivial IndexedDB read. */
export async function probeIdb(): Promise<number> {
  const started = performance.now();
  await getDb().settings.limit(1).toArray();
  return Math.round(performance.now() - started);
}

/** Recount tables in the background; at most one refresh runs at a time. */
export function refreshStorageSnapshot(): Promise<void> {
  refreshing ??= (async () => {
    const started = performance.now();
    try {
      const db = getDb();
      const tableCounts: Record<string, number> = {};
      await Promise.all(
        SIZED_TABLES.filter((name) => db.tables.some((table) => table.name === name)).map(async (name) => {
          tableCounts[name] = await db.table(name).count();
        }),
      );
      const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
      const lookupProbeMs = await probeLookups().catch(() => undefined);
      snapshot = {
        tableCounts,
        lookupProbeMs,
        usageMb: estimate?.usage === undefined ? undefined : Math.round(estimate.usage / 1_048_576),
        quotaMb: estimate?.quota === undefined ? undefined : Math.round(estimate.quota / 1_048_576),
        takenAt: new Date().toISOString(),
        tookMs: Math.round(performance.now() - started),
      };
    } catch {
      // Diagnostics only: a failed count must not disturb the app.
    } finally {
      refreshing = undefined;
    }
  })();
  return refreshing;
}

export function getStorageSnapshot(): StorageSnapshot | undefined {
  return snapshot;
}
