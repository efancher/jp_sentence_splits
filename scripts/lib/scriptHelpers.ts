import type { createScriptSupabaseClient } from './scriptSupabaseClient';

type SupabaseClient = Awaited<ReturnType<typeof createScriptSupabaseClient>>;

// Never send version/created_at/updated_at on an upsert payload — the DB
// owns them (column defaults on insert, set_updated_at/bump_version
// triggers on update) as long as they're simply absent from the payload.
// Sending an explicit version resets the optimistic-concurrency counter
// instead of bumping it on update (see import-wanikani-kanji.ts's
// onConflict comment for the same underlying trigger behavior).
export function withoutVersionAndTimestamps<T extends Record<string, unknown>>(
  row: T,
): Omit<T, 'version' | 'created_at' | 'updated_at'> {
  const rest: Record<string, unknown> = { ...row };
  delete rest.version;
  delete rest.created_at;
  delete rest.updated_at;
  return rest as Omit<T, 'version' | 'created_at' | 'updated_at'>;
}

const SELECT_PAGE_SIZE = 1000;
const WRITE_BATCH_SIZE = 500;

export async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  ownerId: string,
  mapRow: (row: Record<string, unknown>) => T,
  // Most tables have a plain `id text primary key`, but analyses/inbox use
  // `sentence_id` as their primary key instead (see idColumnForEntity in
  // src/sync/mappers.ts) and have no `id` column at all — pass the real
  // primary key column here for those. .range()-based pagination without a
  // stable sort has no guaranteed page boundary under concurrent writes (a
  // row can shift between pages, getting silently skipped); an immutable
  // primary key keeps page boundaries stable regardless.
  orderColumn = 'id',
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq('owner_id', ownerId)
      .is('deleted_at', null)
      .order(orderColumn, { ascending: true })
      .range(from, from + SELECT_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to fetch existing ${table}: ${error.message}`);
    for (const row of data ?? []) out.push(mapRow(row as unknown as Record<string, unknown>));
    if (!data || data.length < SELECT_PAGE_SIZE) break;
    from += SELECT_PAGE_SIZE;
  }
  return out;
}

export async function upsertBatched(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += WRITE_BATCH_SIZE) {
    const batch = rows.slice(i, i + WRITE_BATCH_SIZE);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) {
      throw new Error(`Upsert into ${table} failed on batch starting at ${i}: ${error.message}`);
    }
  }
}

// Plain insert, not upsert — for tables where the natural dedup key is only
// a *partial* unique index (e.g. `where deleted_at is null`), which
// PostgREST's upsert can't target as an ON CONFLICT arbiter (the same
// 42P10 class of error already hit and fixed for the kanji importer, see
// docs/STATUS.md Phase 2). Callers must pre-fetch existing rows and filter
// out already-present keys themselves before calling this.
export async function insertBatched(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += WRITE_BATCH_SIZE) {
    const batch = rows.slice(i, i + WRITE_BATCH_SIZE);
    const { error } = await supabase.from(table).insert(batch);
    if (error) {
      throw new Error(`Insert into ${table} failed on batch starting at ${i}: ${error.message}`);
    }
  }
}

export function parseApplyFlag(argv: string[]): boolean {
  return argv.includes('--apply');
}

export async function requireAuthedUser(
  supabase: SupabaseClient,
): Promise<{ id: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Signed in but no user on session — unexpected.');
  return user;
}
