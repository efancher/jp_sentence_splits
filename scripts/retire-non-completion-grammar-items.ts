/**
 * Second grammar-ladder retirement pass (docs/ROADMAP.md, 2026-09-15): the
 * previous ambient-notice-row redesign (retired same day) had already
 * soft-deleted the 5 live `grammar_*` study items and this same script's
 * precedent (`scripts/retire-grammar-study-items.ts`) restored them when
 * that redesign was reverted. The new design keeps exactly one grammar
 * activity type, `grammar_completion` (rebuilt with always-visible
 * translation + passage context) — `grammar_comprehension` and
 * `grammar_production` are retired again, this time for good.
 *
 * Unlike the full retirement, this is a partial one: both currently
 * tracked patterns already have a live `grammar_completion` item, so
 * there's nothing to relabel onto — just soft-delete the non-completion
 * siblings and leave `grammar_completion`'s FSRS state untouched.
 *
 * Soft-delete only (`deleted_at`), never raw DELETE — the sync engine
 * needs the tombstone. Dry-run by default; --apply required to write.
 * Idempotent: once no non-completion grammar_* rows remain, this is a
 * no-op.
 *
 * Usage: npx tsx scripts/retire-non-completion-grammar-items.ts [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Row = Record<string, any>;

const RETIRE_ACTIVITY_TYPES = ['grammar_comprehension', 'grammar_contrast', 'grammar_production'];

async function fetchAll(
  supabase: any,
  table: string,
  columns: string,
  apply: (q: any) => any,
): Promise<Row[]> {
  const rows: Row[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await apply(
      supabase.from(table).select(columns).is('deleted_at', null),
    )
      .order('id', { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < page) break;
    from += page;
  }
  return rows;
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const items = await fetchAll(
    supabase,
    'study_items',
    'id, subject_id, activity_type, fsrs_state',
    (q) =>
      q
        .eq('owner_id', user.id)
        .eq('subject_type', 'grammarPattern')
        .in('activity_type', RETIRE_ACTIVITY_TYPES),
  );

  if (items.length === 0) {
    console.log('No live non-completion grammar study items. Nothing to retire.');
    return;
  }

  const patternIds = [...new Set(items.map((item) => item.subject_id))];
  const patterns = await fetchAll(supabase, 'grammar_patterns', 'id, canonical_name', (q) =>
    q.eq('owner_id', user.id).in('id', patternIds),
  );
  const patternName = new Map(patterns.map((p) => [p.id, p.canonical_name]));

  console.log(`${items.length} live non-completion grammar_* study item(s):\n`);
  for (const item of items) {
    const name = patternName.get(item.subject_id) ?? item.subject_id;
    console.log(
      `  retire  ${item.id}  ${item.activity_type}  pattern="${name}"  reps=${item.fsrs_state?.reps ?? 0}  lapses=${item.fsrs_state?.lapses ?? 0}`,
    );
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
    return;
  }

  const nowIso = new Date().toISOString();
  for (const item of items) {
    const { error } = await supabase
      .from('study_items')
      .update({ deleted_at: nowIso })
      .eq('id', item.id)
      .eq('owner_id', user.id);
    if (error) throw new Error(`retire ${item.id}: ${error.message}`);
  }

  console.log(`\nDone. Retired ${items.length} study item(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
