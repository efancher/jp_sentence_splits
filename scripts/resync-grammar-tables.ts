/**
 * One-off recovery: force every client to re-pull the grammar subsystem.
 *
 * A client can permanently miss a row when `pullChanges` (src/sync/engine.ts)
 * advances `lastPullEventId` past a `sync_events` row that
 * `shouldApplyRemoteEvent` transiently returned false for (a local pending
 * write, an open conflict, or stale `syncRecordMeta` at that moment) — the
 * skipped event is never revisited, and there is no "full re-pull" action
 * outside the first-run MigrationModal. Symptom seen 2026-09-02: a
 * `grammarPattern`-subject study_item whose pattern row is absent locally, so
 * `/study-items/:id` shows "Subject not found (may have been deleted)".
 *
 * This bumps `updated_at` on every live grammar_patterns / sentence_grammar /
 * grammar_relationships row — a no-op content change that fires the
 * `append_sync_event` trigger with a fresh event id > any client cursor and a
 * bumped version, so the next incremental pull fetches and upserts the row
 * (missing rows included: no local `syncRecordMeta` → `shouldApplyRemoteEvent`
 * returns true). No content is modified.
 *
 * Dry-run by default; --apply to write. Idempotent (safe to re-run).
 *
 * Usage: npx tsx scripts/resync-grammar-tables.ts [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const TABLES = ['grammar_patterns', 'sentence_grammar', 'grammar_relationships'] as const;

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const now = new Date().toISOString();

  for (const table of TABLES) {
    const { data: rows, error } = await supabase
      .from(table)
      .select('id')
      .eq('owner_id', user.id)
      .is('deleted_at', null);
    if (error) throw new Error(`${table}: ${error.message}`);
    const ids = (rows ?? []).map((r) => r.id as string);
    console.log(`${table}: ${ids.length} live row(s)${apply ? ' — touching' : ''}`);
    if (!apply) continue;

    for (const id of ids) {
      const { error: touchError } = await supabase
        .from(table)
        .update({ updated_at: now })
        .eq('id', id)
        .eq('owner_id', user.id);
      if (touchError) throw new Error(`${table} ${id}: ${touchError.message}`);
    }
  }

  console.log(
    apply
      ? '\nDone. Every client re-pulls these rows on its next sync.'
      : '\nDry run — nothing written. Re-run with --apply.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
