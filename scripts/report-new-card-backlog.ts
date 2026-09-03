/**
 * Read-only: how many confirmed vocabulary words have never been introduced
 * to the SRS — the "new-card backlog" the session planner reserves review
 * minutes for (`countNewVocabularyCardBacklog` in src/db/repository.ts) and
 * ReviewPage seeds lazily at `newCardsPerSessionLimit` (default 20) per
 * daily session.
 *
 * A word counts as backlog when a `surface_form`-bearing `sentence_vocabulary`
 * link exists for it but no `study_items` row of subject_type
 * 'vocabularyItem' does (any activity type). Mirrors the repository helper.
 *
 * Usage: npx tsx scripts/report-new-card-backlog.ts
 */
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function fetchAll(supabase: any, table: string, columns: string) {
  const rows: any[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .is('deleted_at', null)
      .range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < page) break;
    from += page;
  }
  return rows;
}

async function main() {
  const supabase = await createScriptSupabaseClient();
  const [links, vocabularyItems, studyItems] = await Promise.all([
    fetchAll(supabase, 'sentence_vocabulary', 'vocabulary_item_id, surface_form'),
    fetchAll(supabase, 'vocabulary_items', 'id, expression, reading'),
    fetchAll(supabase, 'study_items', 'subject_type, subject_id'),
  ]);

  const introduced = new Set(
    studyItems.filter((s) => s.subject_type === 'vocabularyItem').map((s) => s.subject_id),
  );
  const nameById = new Map(
    vocabularyItems.map((v) => [v.id, v.expression || v.reading || v.id]),
  );

  const backlog = new Set<string>();
  for (const link of links) {
    if (!link.surface_form) continue;
    if (introduced.has(link.vocabulary_item_id)) continue;
    backlog.add(link.vocabulary_item_id);
  }

  const confirmed = new Set(
    links.filter((l) => l.surface_form).map((l) => l.vocabulary_item_id),
  );

  console.log(`confirmed vocabulary words:        ${confirmed.size}`);
  console.log(`  ...already in the SRS:           ${confirmed.size - backlog.size}`);
  console.log(`  ...new-card backlog:             ${backlog.size}`);
  console.log(
    `\nAt newCardsPerSessionLimit=20 that's ~${Math.ceil(backlog.size / 20)} daily sessions to drain.`,
  );
  console.log('Raise the limit in Settings → "New cards per review session" to go faster.\n');

  const sample = [...backlog].slice(0, 30).map((id) => nameById.get(id));
  if (sample.length) console.log(`sample: ${sample.join('  ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
