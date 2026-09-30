/**
 * Repairs what `npm run check:sentence-integrity` reports as dangling: live
 * book_sentences rows and reference_audio clips whose sentence is soft-deleted
 * or missing. Repair = soft-delete (deleted_at), never a raw DELETE, so other
 * clients learn of it through sync. Rows only; Storage blobs are left.
 *
 * Does not touch misordered chapters (a separate, per-chapter decision).
 * Dry-run by default; --apply required to write.
 * Usage: npm run repair:dangling-sentence-rows [-- --apply]
 */
import { findIntegrityProblems } from '../src/lib/sentenceIntegrity';
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const PAGE = 1000;

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const fetchAll = async <T>(table: string, columns: string, liveOnly: boolean): Promise<T[]> => {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      let query = supabase.from(table).select(columns).eq('owner_id', user.id);
      if (liveOnly) query = query.is('deleted_at', null);
      const { data, error } = await query.order('id').range(from, from + PAGE - 1);
      if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`);
      rows.push(...((data ?? []) as unknown as T[]));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  };

  const report = findIntegrityProblems({
    memberships: await fetchAll('book_sentences', 'id, book_id, sentence_id, chapter_id, position', true),
    sentences: await fetchAll('sentences', 'id, deleted_at', false),
    clips: await fetchAll('reference_audio', 'id, sentence_id, source_id, source_start_ms', true),
  });

  console.log(`${report.danglingMemberships.length} dangling membership(s), ${report.orphanClips.length} orphan clip(s).`);
  for (const m of report.danglingMemberships) console.log(`  book_sentences ${m.id} (sentence ${m.sentence_id}, pos ${m.position})`);
  for (const c of report.orphanClips) console.log(`  reference_audio ${c.id} (sentence ${c.sentence_id})`);
  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to soft-delete these rows.');
    return;
  }

  const now = new Date().toISOString();
  for (const [table, ids] of [
    ['book_sentences', report.danglingMemberships.map((m) => m.id)],
    ['reference_audio', report.orphanClips.map((c) => c.id)],
  ] as const) {
    for (const id of ids) {
      const { error } = await supabase.from(table).update({ deleted_at: now }).eq('id', id).eq('owner_id', user.id);
      if (error) throw new Error(`Failed to soft-delete ${table} ${id}: ${error.message}`);
    }
  }
  console.log('\nDone. Re-run npm run check:sentence-integrity to confirm.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
