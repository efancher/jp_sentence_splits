/**
 * One-time retirement of the 4-card grammar FSRS ladder (docs/ROADMAP.md,
 * 2026-09-15 — "Grammar SRS: noticing + in-context reading vs. the isolated
 * drill ladder"). `grammar_comprehension`/`grammar_completion`/
 * `grammar_contrast`/`grammar_production` study items are gone from the app
 * entirely — tracked grammar patterns now surface via `SentenceGrammar.
 * confirmedByLearner` plus an ambient reveal check (SentenceGrammarNoticeRow),
 * no dedicated FSRS card.
 *
 * Unlike the `comprehension` → `reading_in_context` precedent
 * (migrate-comprehension-to-reading-in-context.ts), there is no successor
 * activity type to relabel onto — this just soft-deletes every live
 * `grammarPattern`-subject study_item. A 2026-09-15 data check found only
 * 5 such rows across 2 patterns in prod, so no batching/paging concerns.
 *
 * Before deleting, backfills `sentence_grammar.confirmed_by_learner = true`
 * for any pattern that had a live study item but whose links were somehow
 * never confirmed (shouldn't happen — Track always set confirmedByLearner —
 * but this is the one place the "noticed" signal could otherwise be lost).
 *
 * Soft-delete only (`deleted_at`), never raw DELETE — the sync engine needs
 * the tombstone. Dry-run by default; --apply required to write. Idempotent:
 * once no live grammarPattern-subject study_items remain, this is a no-op.
 *
 * Usage: npx tsx scripts/retire-grammar-study-items.ts [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Row = Record<string, any>;

const GRAMMAR_ACTIVITY_TYPES = [
  'grammar_comprehension',
  'grammar_completion',
  'grammar_contrast',
  'grammar_production',
];

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

  const grammarItems = await fetchAll(
    supabase,
    'study_items',
    'id, subject_id, activity_type, fsrs_state',
    (q) =>
      q
        .eq('owner_id', user.id)
        .eq('subject_type', 'grammarPattern')
        .in('activity_type', GRAMMAR_ACTIVITY_TYPES),
  );

  if (grammarItems.length === 0) {
    console.log('No live grammarPattern-subject study items. Nothing to retire.');
    return;
  }

  const patternIds = [...new Set(grammarItems.map((item) => item.subject_id))];
  const patterns = await fetchAll(supabase, 'grammar_patterns', 'id, canonical_name', (q) =>
    q.eq('owner_id', user.id).in('id', patternIds),
  );
  const patternName = new Map(patterns.map((p) => [p.id, p.canonical_name]));

  const links = await fetchAll(
    supabase,
    'sentence_grammar',
    'id, grammar_pattern_id, confirmed_by_learner',
    (q) => q.eq('owner_id', user.id).in('grammar_pattern_id', patternIds),
  );
  const unconfirmedLinksToBackfill = links.filter((link) => !link.confirmed_by_learner);

  console.log(`${grammarItems.length} live grammar_* study item(s) across ${patternIds.length} pattern(s):\n`);
  for (const item of grammarItems) {
    const name = patternName.get(item.subject_id) ?? item.subject_id;
    console.log(
      `  retire  ${item.id}  ${item.activity_type}  pattern="${name}"  reps=${item.fsrs_state?.reps ?? 0}  lapses=${item.fsrs_state?.lapses ?? 0}`,
    );
  }
  if (unconfirmedLinksToBackfill.length > 0) {
    console.log(
      `\n${unconfirmedLinksToBackfill.length} sentence_grammar link(s) on these patterns aren't confirmed — backfilling confirmed_by_learner=true so the "noticed" signal survives:`,
    );
    for (const link of unconfirmedLinksToBackfill) {
      console.log(`  confirm  ${link.id}  pattern=${patternName.get(link.grammar_pattern_id) ?? link.grammar_pattern_id}`);
    }
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
    return;
  }

  const nowIso = new Date().toISOString();
  for (const link of unconfirmedLinksToBackfill) {
    const { error } = await supabase
      .from('sentence_grammar')
      .update({ confirmed_by_learner: true, updated_at: nowIso })
      .eq('id', link.id)
      .eq('owner_id', user.id);
    if (error) throw new Error(`confirm ${link.id}: ${error.message}`);
  }
  for (const item of grammarItems) {
    const { error } = await supabase
      .from('study_items')
      .update({ deleted_at: nowIso })
      .eq('id', item.id)
      .eq('owner_id', user.id);
    if (error) throw new Error(`retire ${item.id}: ${error.message}`);
  }

  console.log(
    `\nDone. Confirmed ${unconfirmedLinksToBackfill.length} link(s), retired ${grammarItems.length} study item(s).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
