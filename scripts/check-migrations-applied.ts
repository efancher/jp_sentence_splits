/**
 * Read-only check that the production database has every table and column the
 * repo's `supabase/migrations/*.sql` create.
 *
 * Why: migrations don't reach prod on their own unless the Supabase GitHub
 * integration / a `db push` step is wired up and its history is in sync, and a
 * missed one fails quietly — PostgREST rejects the push, sync retries forever,
 * and a device shows stale data (2026-09-11/12: a suspended book kept showing
 * reviews on the phone because `books.suspended_at` was never applied).
 *
 * How: replays the migration files into the expected tables/columns
 * (`scripts/lib/migrationSchema.ts`, verified against a real Postgres by
 * `npm run test:pg`) and asks PostgREST for each with `select=cols&limit=0`.
 * Only tables and columns are covered — not policies, indexes, functions or
 * storage buckets. Uses the same signed-in anon client as the other check
 * scripts; RLS returns zero rows, but a missing column/table is still an error.
 *
 * If a column you just applied is reported missing, PostgREST's schema cache is
 * probably stale: run `notify pgrst, 'reload schema';` in the SQL editor.
 *
 * Usage: npm run check:migrations-applied   (exits 1 when anything is missing)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expectedSchemaFromMigrations } from './lib/migrationSchema';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../supabase/migrations');

async function main() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));
  const expected = expectedSchemaFromMigrations(files);
  const supabase = await createScriptSupabaseClient();

  const problems: string[] = [];
  let columnCount = 0;
  for (const [table, columns] of [...expected].sort(([a], [b]) => a.localeCompare(b))) {
    columnCount += columns.size;
    const whole = await supabase.from(table).select([...columns].join(',')).limit(0);
    if (!whole.error) continue;

    // Something is off: probe column by column to say exactly what.
    const missing: string[] = [];
    let tableMissing = false;
    for (const column of [...columns].sort()) {
      const { error } = await supabase.from(table).select(column).limit(0);
      if (!error) continue;
      if (error.code === '42703') missing.push(column);
      else if (error.code === 'PGRST205' || error.code === '42P01') {
        tableMissing = true;
        break;
      } else problems.push(`${table}.${column}: unexpected error ${error.code ?? '?'} — ${error.message}`);
    }
    if (tableMissing) problems.push(`${table}: table missing`);
    else if (missing.length) problems.push(`${table}: missing column(s) ${missing.join(', ')}`);
    else if (!problems.some((p) => p.startsWith(`${table}.`))) {
      problems.push(`${table}: probe failed — ${whole.error.code ?? '?'} ${whole.error.message}`);
    }
  }

  if (!problems.length) {
    console.log(`Schema OK: ${expected.size} tables / ${columnCount} columns from ${files.length} migrations all present.`);
    return;
  }
  console.log(`${problems.length} problem(s) — prod is missing something the migrations create:\n`);
  for (const problem of problems) console.log(`  ${problem}`);
  console.log(
    '\nApply the newest migration(s) (SQL editor or `supabase db push`), then rerun. ' +
      "If it was already applied, run `notify pgrst, 'reload schema';` to refresh PostgREST's cache.",
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
