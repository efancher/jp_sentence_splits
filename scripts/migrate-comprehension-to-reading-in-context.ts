/**
 * One-time migration for the `comprehension` retirement (docs/STATUS.md
 * 2026-09-08 — user: "always better to learn in context if possible").
 *
 * `comprehension` (JP sentence in isolation, reveal EN + vocab, self-rate)
 * and `reading_in_context` (same reveal flow, sentence framed by its
 * reading-order passage) were two sentence-subject activity types. The
 * isolated one is gone; `reading_in_context` is now the only sentence card.
 * This moves the accumulated FSRS scheduling state + review history off the
 * old rows so the learner doesn't restart those sentences from zero.
 *
 * For each live `comprehension` study_item:
 *   - No live `reading_in_context` sibling (same sentence) → flip its
 *     `activity_type` to `reading_in_context` in place (id unchanged, so the
 *     append-only `reviews` rows follow it).
 *   - A live `reading_in_context` sibling already exists → keep whichever of
 *     the two is further along (reps, then scheduledDays, then lastReview),
 *     soft-delete the other. If the survivor is the `comprehension` row,
 *     soft-delete the sibling first, then flip.
 *
 * Soft-delete only (`deleted_at`), never raw DELETE (clients learn via
 * sync). Append-only `reviews` rows are never touched — those on a
 * soft-deleted loser are left dangling, harmless.
 *
 * Dry-run by default; --apply required to write. Idempotent: once every
 * `comprehension` row is gone there is nothing left to match.
 *
 * Usage: npx tsx scripts/migrate-comprehension-to-reading-in-context.ts [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Row = Record<string, any>;

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

/** >0 when `a` is further along than `b`, <0 when `b` is, 0 when equal. */
function progressDelta(a: Row, b: Row): number {
  const fa = a.fsrs_state ?? {};
  const fb = b.fsrs_state ?? {};
  if ((fa.reps ?? 0) !== (fb.reps ?? 0)) return (fa.reps ?? 0) - (fb.reps ?? 0);
  if ((fa.scheduledDays ?? 0) !== (fb.scheduledDays ?? 0)) {
    return (fa.scheduledDays ?? 0) - (fb.scheduledDays ?? 0);
  }
  const la = fa.lastReview ? Date.parse(fa.lastReview) : 0;
  const lb = fb.lastReview ? Date.parse(fb.lastReview) : 0;
  return la - lb;
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const sentenceItems = await fetchAll(
    supabase,
    'study_items',
    'id, subject_id, activity_type, fsrs_state',
    (q) =>
      q
        .eq('owner_id', user.id)
        .eq('subject_type', 'sentence')
        .in('activity_type', ['comprehension', 'reading_in_context']),
  );

  const comprehension = sentenceItems.filter((r) => r.activity_type === 'comprehension');
  const readingBySentence = new Map<string, Row>();
  for (const r of sentenceItems) {
    if (r.activity_type === 'reading_in_context') readingBySentence.set(r.subject_id, r);
  }

  if (comprehension.length === 0) {
    console.log('No live `comprehension` study items. Nothing to migrate.');
    return;
  }

  const reviewRows = await fetchAll(supabase, 'reviews', 'study_item_id', (q) =>
    q.eq('owner_id', user.id),
  );
  const reviewCount = new Map<string, number>();
  for (const r of reviewRows) {
    reviewCount.set(r.study_item_id, (reviewCount.get(r.study_item_id) ?? 0) + 1);
  }

  const flips: Row[] = []; // comprehension row → becomes reading_in_context
  const softDeletes: { row: Row; reason: string }[] = [];

  for (const c of comprehension) {
    const sibling = readingBySentence.get(c.subject_id);
    if (!sibling) {
      flips.push(c);
      continue;
    }
    if (progressDelta(c, sibling) > 0) {
      // comprehension is further along — it wins the slot.
      softDeletes.push({ row: sibling, reason: `superseded by comprehension ${c.id}` });
      flips.push(c);
    } else {
      // reading_in_context sibling is at least as far along — drop the old row.
      softDeletes.push({ row: c, reason: `already have reading_in_context ${sibling.id}` });
    }
  }

  console.log(`${comprehension.length} live comprehension study item(s):`);
  console.log(`  ${flips.length} to relabel → reading_in_context`);
  console.log(`  ${softDeletes.length} to soft-delete (sentence already has a reading_in_context card)\n`);

  for (const c of flips) {
    console.log(
      `  relabel ${c.id}  sentence=${c.subject_id}  reps=${c.fsrs_state?.reps ?? 0} reviews=${reviewCount.get(c.id) ?? 0}`,
    );
  }
  for (const { row, reason } of softDeletes) {
    console.log(
      `  delete  ${row.id}  (${row.activity_type})  sentence=${row.subject_id}  reviews=${reviewCount.get(row.id) ?? 0}  — ${reason}`,
    );
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
    return;
  }

  const nowIso = new Date().toISOString();
  // Soft-delete losers first so relabels never collide with a live sibling
  // on the (owner, subject_type, subject_id, activity_type) partial-unique
  // index.
  for (const { row } of softDeletes) {
    const { error } = await supabase
      .from('study_items')
      .update({ deleted_at: nowIso })
      .eq('id', row.id)
      .eq('owner_id', user.id);
    if (error) throw new Error(`soft-delete ${row.id}: ${error.message}`);
  }
  for (const c of flips) {
    const { error } = await supabase
      .from('study_items')
      .update({ activity_type: 'reading_in_context' })
      .eq('id', c.id)
      .eq('owner_id', user.id);
    if (error) throw new Error(`relabel ${c.id}: ${error.message}`);
  }

  console.log(
    `\nDone. Relabelled ${flips.length}, soft-deleted ${softDeletes.length} study item(s).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
