/**
 * Server-side cache of raw WaniKani subject payloads in the
 * `wanikani_subjects` table, so `scripts/import-wanikani-kanji.ts` and
 * `scripts/backfill-wanikani-mnemonics.ts` don't re-page the whole WaniKani
 * catalog every run. After the first populate each sync is an incremental
 * `updated_after` pull keyed on the newest `data_updated_at` already cached.
 *
 * Script-only — not wired into the TS sync engine / Dexie / JSON backup.
 */
import { fetchWanikaniSubjectsRaw, type WkRawSubject } from './wanikani';
import { createScriptSupabaseClient } from './scriptSupabaseClient';
import { upsertBatched } from './scriptHelpers';

type SupabaseClient = Awaited<ReturnType<typeof createScriptSupabaseClient>>;

const SELECT_PAGE_SIZE = 1000;

interface CachedRow {
  wk_id: number;
  object: string;
  data: Record<string, unknown>;
  data_updated_at: string;
}

/** Newest `data_updated_at` among the rows, or null for an empty set — the incremental cursor. */
export function latestDataUpdatedAt(
  rows: { data_updated_at: string }[],
): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (!latest || row.data_updated_at > latest) latest = row.data_updated_at;
  }
  return latest;
}

/** A cached subject is usable unless WaniKani has since hidden it. */
export function isVisibleSubject(subject: WkRawSubject): boolean {
  return !subject.data.hidden_at;
}

async function fetchCursor(
  supabase: SupabaseClient,
  ownerId: string,
  objectTypes: string[],
): Promise<string | null> {
  const { data, error } = await supabase
    .from('wanikani_subjects')
    .select('data_updated_at')
    .eq('owner_id', ownerId)
    .in('object', objectTypes)
    .order('data_updated_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Failed to read WaniKani cache cursor: ${error.message}`);
  return data && data.length ? (data[0].data_updated_at as string) : null;
}

/**
 * Pulls subjects changed since the cache's cursor from the WaniKani API and
 * upserts them into `wanikani_subjects`. Returns how many the API returned
 * (0 once the cache is warm and nothing changed).
 */
export async function syncWanikaniSubjectCache(
  supabase: SupabaseClient,
  ownerId: string,
  token: string,
  objectTypes: string[],
): Promise<{ fetched: number }> {
  const cursor = await fetchCursor(supabase, ownerId, objectTypes);
  const subjects = await fetchWanikaniSubjectsRaw(token, {
    types: objectTypes,
    updatedAfter: cursor,
  });
  if (subjects.length) {
    const now = new Date().toISOString();
    const rows = subjects.map((s) => ({
      owner_id: ownerId,
      wk_id: s.id,
      object: s.object,
      data: s.data,
      data_updated_at: s.data_updated_at,
      fetched_at: now,
    }));
    await upsertBatched(supabase, 'wanikani_subjects', rows, 'owner_id,wk_id');
  }
  return { fetched: subjects.length };
}

/**
 * Reads cached subjects of the given object types, reconstructed into the
 * `{ id, object, data }` shape the pure transforms in `wanikani.ts` expect.
 * Hidden subjects are dropped here (they're kept in the table so the
 * incremental cursor stays correct).
 */
export async function readCachedWanikaniSubjects<T = WkRawSubject>(
  supabase: SupabaseClient,
  ownerId: string,
  objectTypes: string[],
): Promise<T[]> {
  const out: WkRawSubject[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('wanikani_subjects')
      .select('wk_id, object, data, data_updated_at')
      .eq('owner_id', ownerId)
      .in('object', objectTypes)
      .order('wk_id', { ascending: true })
      .range(from, from + SELECT_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to read WaniKani cache: ${error.message}`);
    const rows = (data ?? []) as unknown as CachedRow[];
    for (const row of rows) {
      out.push({
        id: row.wk_id,
        object: row.object,
        data_updated_at: row.data_updated_at,
        data: row.data,
      });
    }
    if (rows.length < SELECT_PAGE_SIZE) break;
    from += SELECT_PAGE_SIZE;
  }
  return out.filter(isVisibleSubject) as unknown as T[];
}
