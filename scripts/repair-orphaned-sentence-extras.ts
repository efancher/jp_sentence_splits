/**
 * Repoints sentence_extras (AI chunk drafts, construction layers, walkthroughs) whose
 * book_id is a deleted/missing book to the live book their sentence now belongs to.
 * Needed after a book was merged into another before mergeBookIntoChapter learned to
 * carry extras across: the target then showed the sentences as unchunked.
 *
 * Rows whose sentence is in no live book, or in several, are reported and left alone.
 * Dry-run by default; --apply required to write. After applying, clients pick the
 * change up through normal sync (the row's version is bumped by the DB trigger).
 *
 * Usage: npm run repair:orphaned-sentence-extras [-- --apply]
 */
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { planOrphanedExtrasRepair, type ExtrasRef, type MembershipRef } from './lib/orphanedExtras';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const str = (value: unknown): string | null => (value == null ? null : String(value));

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const [books, extras, memberships] = await Promise.all([
    fetchAll(supabase, 'books', 'id, title', user.id, (r) => ({ id: String(r.id), title: String(r.title) })),
    fetchAll<ExtrasRef>(supabase, 'sentence_extras', 'id, book_id, chapter_id', user.id, (r) => ({
      id: String(r.id),
      bookId: str(r.book_id),
      chapterId: str(r.chapter_id),
    })),
    fetchAll<MembershipRef>(supabase, 'book_sentences', 'id, sentence_id, book_id, chapter_id', user.id, (r) => ({
      sentenceId: String(r.sentence_id),
      bookId: String(r.book_id),
      chapterId: str(r.chapter_id),
    })),
  ]);
  const titles = new Map(books.map((b) => [b.id, b.title]));
  const plan = planOrphanedExtrasRepair(extras, new Set(titles.keys()), memberships);

  console.log(`${extras.length} sentence_extras rows; ${plan.repoints.length} orphaned and repairable, ${plan.unresolved.length} unresolved.`);
  const perBook = new Map<string, number>();
  for (const r of plan.repoints) perBook.set(r.to.bookId, (perBook.get(r.to.bookId) ?? 0) + 1);
  for (const [bookId, count] of perBook) console.log(`  -> "${titles.get(bookId)}" (${bookId}): ${count} row(s)`);
  for (const u of plan.unresolved) console.log(`  unresolved ${u.id}: ${u.reason}`);

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
    return;
  }
  for (const r of plan.repoints) {
    const { error } = await supabase
      .from('sentence_extras')
      .update({ book_id: r.to.bookId, chapter_id: r.to.chapterId })
      .eq('owner_id', user.id)
      .eq('id', r.id);
    if (error) throw new Error(`Failed to repoint sentence_extras ${r.id}: ${error.message}`);
  }
  console.log(`\nDone. Repointed ${plan.repoints.length} row(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
