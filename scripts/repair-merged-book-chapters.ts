/**
 * Repairs chapters flattened by the old "Move into other book" flow
 * (mergeBookIntoChapter): the source book's whole content landed as ONE chapter
 * titled after the book (e.g. a podcast series name) instead of keeping each
 * episode chapter, so episodes lost their titles and several merged together.
 *
 * Recovery uses mining_imports, which still records each episode's original
 * source book, chapter id and sentence count, plus the soft-deleted source
 * book's chapter list (titles, source ids, dates, order). Sentences are split
 * by their preserved position order. Aborts if the counts do not add up.
 *
 * Dry-run by default; --apply required to write. Re-running after --apply
 * finds nothing to repair.
 * Usage: npm run repair:merged-book-chapters -- <targetBookId> [--apply]
 */
import { createId } from '../src/lib/ids';
import {
  applySplitToChapters,
  isCollapsedFrom,
  planChapterSplit,
  type ChapterSplit,
  type PlanChapter,
  type PlanImport,
  type PlanMembership,
  type PlanSourceBook,
} from './lib/splitMergedChapters';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type SupabaseClient = Awaited<ReturnType<typeof createScriptSupabaseClient>>;

async function fetchBookSentences(supabase: SupabaseClient, ownerId: string, bookId: string): Promise<PlanMembership[]> {
  const rows: PlanMembership[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('book_sentences')
      .select('id, sentence_id, position, chapter_id')
      .eq('owner_id', ownerId)
      .eq('book_id', bookId)
      .is('deleted_at', null)
      .order('position', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`Failed to fetch book_sentences: ${error.message}`);
    for (const row of data ?? []) {
      rows.push({
        id: String(row.id),
        sentenceId: String(row.sentence_id),
        position: Number(row.position),
        ...(row.chapter_id ? { chapterId: String(row.chapter_id) } : {}),
      });
    }
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function writeSplit(supabase: SupabaseClient, bookId: string, split: ChapterSplit, memberships: PlanMembership[]) {
  const rowIdsByChapter = new Map<string, string[]>();
  for (const [rowId, chapterId] of split.reassignments) {
    rowIdsByChapter.set(chapterId, [...(rowIdsByChapter.get(chapterId) ?? []), rowId]);
  }
  for (const [chapterId, rowIds] of rowIdsByChapter) {
    const sentenceIdByRow = new Map(memberships.map((m) => [m.id, m.sentenceId]));
    for (let i = 0; i < rowIds.length; i += 200) {
      const batch = rowIds.slice(i, i + 200);
      const { error } = await supabase.from('book_sentences').update({ chapter_id: chapterId }).in('id', batch);
      if (error) throw new Error(`Failed to reassign book_sentences: ${error.message}`);
      const sentenceIds = batch.map((id) => sentenceIdByRow.get(id)!);
      const { error: extrasError } = await supabase
        .from('sentence_extras')
        .update({ chapter_id: chapterId })
        .eq('book_id', bookId)
        .in('id', sentenceIds);
      if (extrasError) throw new Error(`Failed to reassign sentence_extras: ${extrasError.message}`);
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const targetBookId = argv.find((arg) => arg !== '--apply');
  if (!targetBookId) throw new Error('Usage: tsx scripts/repair-merged-book-chapters.ts <targetBookId> [--apply]');

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const { data: target, error: targetError } = await supabase
    .from('books')
    .select('id, title, chapters')
    .eq('owner_id', user.id)
    .eq('id', targetBookId)
    .is('deleted_at', null)
    .maybeSingle();
  if (targetError) throw new Error(`Failed to fetch book: ${targetError.message}`);
  if (!target) throw new Error(`Book ${targetBookId} not found.`);

  const imports = (
    await fetchAll<PlanImport | null>(
      supabase,
      'mining_imports',
      'book_id, chapter_id, sentence_count, status',
      user.id,
      (row) =>
        row.status === 'committed' && row.book_id && row.chapter_id && row.sentence_count
          ? { bookId: String(row.book_id), chapterId: String(row.chapter_id), sentenceCount: Number(row.sentence_count) }
          : null,
    )
  ).filter((item): item is PlanImport => item !== null);

  const sourceIds = [...new Set(imports.map((item) => item.bookId))].filter((id) => id !== targetBookId);
  const { data: sourceRows, error: sourceError } = sourceIds.length
    ? await supabase
        .from('books')
        .select('id, title, created_at, chapters')
        .eq('owner_id', user.id)
        .in('id', sourceIds)
        .not('deleted_at', 'is', null)
    : { data: [], error: null };
  if (sourceError) throw new Error(`Failed to fetch source books: ${sourceError.message}`);
  const sources: PlanSourceBook[] = (sourceRows ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    createdAt: String(row.created_at),
    chapters: (Array.isArray(row.chapters) ? row.chapters : []) as PlanChapter[],
  }));

  const memberships = await fetchBookSentences(supabase, user.id, targetBookId);
  let chapters = (Array.isArray(target.chapters) ? target.chapters : []) as PlanChapter[];
  const splits: ChapterSplit[] = [];
  for (const source of sources) {
    const collapsed = chapters.find((chapter) => isCollapsedFrom(chapter, source));
    if (!collapsed) continue;
    const split = planChapterSplit({ collapsed, source, imports, memberships, newChapterId: () => createId('chapter') });
    splits.push(split);
    chapters = applySplitToChapters(chapters, split);
    console.log(`Collapsed chapter ${collapsed.id} "${collapsed.title}" (from deleted book ${source.id}) becomes:`);
    for (const chapter of split.chapters) {
      const count = memberships.filter((m) => (split.reassignments.get(m.id) ?? m.chapterId) === chapter.id).length;
      console.log(`  - ${chapter.id} "${chapter.title}" (${count} sentences)`);
    }
  }
  if (!splits.length) {
    console.log(`Nothing to repair in "${target.title}".`);
    return;
  }
  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
    return;
  }

  const { error: bookError } = await supabase.from('books').update({ chapters }).eq('id', targetBookId);
  if (bookError) throw new Error(`Failed to update chapters: ${bookError.message}`);
  for (const split of splits) await writeSplit(supabase, targetBookId, split, memberships);
  console.log('\nDone.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
