/**
 * Read-mostly cleanup: soft-delete `reference_audio` rows whose sentence is
 * gone, so the table stops carrying clips nothing can play.
 *
 * Prompted 2026-09-10: `cascadeRetireSentenceLocal` never retired a
 * sentence's reference recordings, so the 2026-09 "After Work" / "GLIM
 * SPANKY" sentence soft-deletes stranded ~140 `reference_audio` rows
 * pointing at deleted sentences. The cascade itself is now fixed in
 * `repository.ts`; this clears what already leaked. (Same story, and same
 * fix shape, as `cleanup-orphaned-study-items.ts`.)
 *
 * Orphan = a live `reference_audio` row whose `sentence_id` has no live
 * `sentences` row.
 *
 * Soft-delete only (`deleted_at`), never raw DELETE — clients learn of the
 * removal on their next pull. `--delete-blobs` additionally removes the
 * Storage object (owner-scoped RLS covers it); without it the blob is left,
 * which is harmless and cheap. Dry-run by default. Idempotent.
 *
 * Usage:
 *   npx tsx scripts/cleanup-orphaned-reference-audio.ts [--apply] [--delete-blobs]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Row = Record<string, any>;

const STORAGE_BUCKET = 'reference-audio';

async function fetchAllRows(
  supabase: any,
  table: string,
  columns: string,
  ownerId: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq('owner_id', ownerId)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`fetch ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < page) break;
    from += page;
  }
  return rows;
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const deleteBlobs = argv.includes('--delete-blobs');

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const audio = await fetchAllRows(
    supabase,
    'reference_audio',
    'id, sentence_id, book_id, source_title, storage_path',
    user.id,
  );
  const liveSentenceIds = new Set(
    (await fetchAllRows(supabase, 'sentences', 'id', user.id)).map((r) => String(r.id)),
  );

  const orphans = audio.filter((r) => !liveSentenceIds.has(String(r.sentence_id)));

  const byBook = new Map<string, { title: string; n: number }>();
  for (const r of orphans) {
    const k = r.book_id ?? '(none)';
    if (!byBook.has(k)) byBook.set(k, { title: r.source_title || '?', n: 0 });
    byBook.get(k)!.n += 1;
  }

  console.log(
    `${audio.length} live reference_audio row(s); ${orphans.length} orphaned ` +
      `(sentence deleted).\n`,
  );
  for (const [bid, g] of [...byBook.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${String(g.n).padStart(4)}  ${g.title.slice(0, 55).padEnd(55)}  ${bid}`);
  }

  if (orphans.length === 0) {
    console.log('\nNothing to do.');
    return;
  }

  if (!apply) {
    console.log(
      `\nDry run — nothing written. Re-run with --apply` +
        `${deleteBlobs ? ' --delete-blobs' : ''} to soft-delete` +
        (deleteBlobs ? ' + remove blobs.' : ' the rows.'),
    );
    return;
  }

  const nowIso = new Date().toISOString();
  let rows = 0;
  let blobs = 0;
  for (const r of orphans) {
    if (deleteBlobs && r.storage_path) {
      const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([r.storage_path]);
      if (error) console.log(`  blob remove failed for ${r.id}: ${error.message}`);
      else blobs += 1;
    }
    const { error } = await supabase
      .from('reference_audio')
      .update({ deleted_at: nowIso })
      .eq('id', r.id)
      .eq('owner_id', user.id);
    if (error) throw new Error(`soft-delete ${r.id}: ${error.message}`);
    rows += 1;
  }

  console.log(
    `\nSoft-deleted ${rows} row(s)` + (deleteBlobs ? `, removed ${blobs} blob(s).` : '.'),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
