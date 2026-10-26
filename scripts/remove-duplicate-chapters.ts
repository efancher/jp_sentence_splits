/**
 * Removes redundant duplicate chapters from a book: the case where one episode
 * was imported twice and merged into its series book both times
 * (merge-book-into-chapter.ts drops sentences the book already has, so the
 * second copy ends up a thin partial chapter next to the full original — Slow
 * Japanese #64/#69/#74/#78, 2026-10-26).
 *
 * Each named chapter is removed only if (a) a surviving chapter has the same
 * canonical sourceId and at least as many sentences, (b) none of its
 * book_sentences has been studied (status other than "unstarted"), and (c) no
 * study_items exist for sentences that would leave the book entirely. Its
 * book_sentences are soft-deleted (never hard-deleted, so clients learn of it
 * through sync), the chapter is dropped from books.chapters, and AI extras
 * (sentence_extras) are repointed at a surviving chapter when the sentence
 * remains there, else soft-deleted with the sentence's membership.
 *
 * Dry-run by default; --apply required to write.
 *
 * Usage: npm run remove:duplicate-chapters -- <bookId> <chapterId> [<chapterId>...] [--apply]
 */
import { canonicalSourceId } from '../src/lib/ids';
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type SupabaseClient = Awaited<ReturnType<typeof createScriptSupabaseClient>>;

interface ChapterRow {
  id: string;
  title: string;
  position: number;
  sourceId?: string;
  [key: string]: unknown;
}

interface MembershipRow {
  id: string;
  sentenceId: string;
  chapterId: string | null;
  status: string;
}

const IN_CHUNK = 100;

async function loadMemberships(supabase: SupabaseClient, ownerId: string, bookId: string): Promise<MembershipRow[]> {
  const rows: MembershipRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('book_sentences')
      .select('id, sentence_id, chapter_id, status')
      .eq('owner_id', ownerId)
      .eq('book_id', bookId)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`Failed to fetch book_sentences: ${error.message}`);
    for (const row of data ?? []) {
      rows.push({
        id: String(row.id),
        sentenceId: String(row.sentence_id),
        chapterId: row.chapter_id ? String(row.chapter_id) : null,
        status: String(row.status),
      });
    }
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += IN_CHUNK) out.push(items.slice(i, i + IN_CHUNK));
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const [bookId, ...chapterIds] = argv.filter((arg) => arg !== '--apply');
  if (!bookId || chapterIds.length === 0) {
    throw new Error('Usage: tsx scripts/remove-duplicate-chapters.ts <bookId> <chapterId> [<chapterId>...] [--apply]');
  }

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const { data: bookRow, error: bookError } = await supabase
    .from('books')
    .select('id, title, chapters')
    .eq('owner_id', user.id)
    .eq('id', bookId)
    .is('deleted_at', null)
    .maybeSingle();
  if (bookError) throw new Error(`Failed to fetch book: ${bookError.message}`);
  if (!bookRow) throw new Error(`Book ${bookId} not found (or deleted).`);
  const chapters = (Array.isArray(bookRow.chapters) ? bookRow.chapters : []) as ChapterRow[];

  const removeSet = new Set(chapterIds);
  for (const id of removeSet) {
    if (!chapters.some((chapter) => chapter.id === id)) throw new Error(`Chapter ${id} is not in "${bookRow.title}".`);
  }
  const surviving = chapters.filter((chapter) => !removeSet.has(chapter.id));

  const memberships = await loadMemberships(supabase, user.id, bookId);
  const byChapter = (chapterId: string) => memberships.filter((row) => row.chapterId === chapterId);

  console.log(`Book "${bookRow.title}" (${bookId}): ${chapters.length} chapters, ${memberships.length} sentences`);

  // (a) a fuller surviving twin exists; (b) nothing studied.
  const problems: string[] = [];
  for (const chapter of chapters.filter((c) => removeSet.has(c.id))) {
    const rows = byChapter(chapter.id);
    const twins = surviving.filter(
      (other) =>
        other.sourceId &&
        chapter.sourceId &&
        canonicalSourceId(other.sourceId) === canonicalSourceId(chapter.sourceId),
    );
    const bestTwin = twins.map((twin) => ({ twin, count: byChapter(twin.id).length })).sort((a, b) => b.count - a.count)[0];
    console.log(
      `  remove "${chapter.title}" (${chapter.id}, position ${chapter.position}): ${rows.length} sentence(s); ` +
        (bestTwin ? `kept twin ${bestTwin.twin.id} has ${bestTwin.count}` : 'NO surviving twin'),
    );
    if (!bestTwin) problems.push(`${chapter.id}: no surviving chapter with the same sourceId`);
    else if (bestTwin.count < rows.length) problems.push(`${chapter.id}: the surviving twin has fewer sentences (${bestTwin.count}) than this chapter (${rows.length})`);
    const studied = rows.filter((row) => row.status !== 'unstarted');
    if (studied.length > 0) problems.push(`${chapter.id}: ${studied.length} sentence(s) have status other than unstarted`);
  }

  const removedRows = memberships.filter((row) => row.chapterId && removeSet.has(row.chapterId));
  const keptSentenceIds = new Set(
    memberships.filter((row) => !(row.chapterId && removeSet.has(row.chapterId))).map((row) => row.sentenceId),
  );
  const leavingSentenceIds = [...new Set(removedRows.map((row) => row.sentenceId).filter((id) => !keptSentenceIds.has(id)))];

  // (c) no study items on sentences that leave the book.
  let studyItemCount = 0;
  for (const chunk of chunks(leavingSentenceIds)) {
    const { count, error } = await supabase
      .from('study_items')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', user.id)
      .in('subject_id', chunk)
      .is('deleted_at', null);
    if (error) throw new Error(`Failed to count study_items: ${error.message}`);
    studyItemCount += count ?? 0;
  }
  console.log(`  ${removedRows.length} book_sentences row(s) to soft-delete; ${leavingSentenceIds.length} sentence(s) leave the book entirely; ${studyItemCount} study item(s) on them.`);
  if (studyItemCount > 0) problems.push(`${studyItemCount} study item(s) exist on sentences that would leave the book`);

  // AI extras are keyed by sentence id; repoint or retire the ones tied to a removed chapter.
  const extrasToRepoint: Array<{ id: string; chapterId: string }> = [];
  const extrasToDelete: string[] = [];
  for (const chunk of chunks([...new Set(removedRows.map((row) => row.sentenceId))])) {
    const { data, error } = await supabase
      .from('sentence_extras')
      .select('id, chapter_id')
      .eq('owner_id', user.id)
      .eq('book_id', bookId)
      .in('id', chunk)
      .is('deleted_at', null);
    if (error) throw new Error(`Failed to fetch sentence_extras: ${error.message}`);
    for (const extra of data ?? []) {
      const id = String(extra.id);
      const chapterId = extra.chapter_id ? String(extra.chapter_id) : null;
      if (!chapterId || !removeSet.has(chapterId)) continue;
      const home = memberships.find(
        (row) => row.sentenceId === id && row.chapterId && !removeSet.has(row.chapterId),
      );
      if (home?.chapterId) extrasToRepoint.push({ id, chapterId: home.chapterId });
      else extrasToDelete.push(id);
    }
  }
  console.log(`  sentence_extras: ${extrasToRepoint.length} repointed to a surviving chapter, ${extrasToDelete.length} soft-deleted.`);

  if (problems.length > 0) {
    console.log('\nRefusing to continue:');
    for (const problem of problems) console.log(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
    return;
  }

  const now = new Date().toISOString();
  for (const chunk of chunks(removedRows.map((row) => row.id))) {
    const { error } = await supabase.from('book_sentences').update({ deleted_at: now }).in('id', chunk);
    if (error) throw new Error(`Failed to soft-delete book_sentences: ${error.message}`);
  }
  for (const { id, chapterId } of extrasToRepoint) {
    const { error } = await supabase.from('sentence_extras').update({ chapter_id: chapterId }).eq('id', id);
    if (error) throw new Error(`Failed to repoint sentence_extras ${id}: ${error.message}`);
  }
  for (const chunk of chunks(extrasToDelete)) {
    const { error } = await supabase.from('sentence_extras').update({ deleted_at: now }).in('id', chunk);
    if (error) throw new Error(`Failed to soft-delete sentence_extras: ${error.message}`);
  }
  const nextChapters = surviving
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((chapter, position) => ({ ...chapter, position }));
  const { error: chaptersError } = await supabase.from('books').update({ chapters: nextChapters }).eq('id', bookId);
  if (chaptersError) throw new Error(`Failed to update chapters: ${chaptersError.message}`);

  const after = await loadMemberships(supabase, user.id, bookId);
  console.log(
    `\nDone. Book now has ${nextChapters.length} chapters and ${after.length} sentences ` +
      `(was ${chapters.length} / ${memberships.length}); ${removedRows.length} membership(s) soft-deleted.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
