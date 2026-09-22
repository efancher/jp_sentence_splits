/**
 * Absorbs one standalone book's sentences into another book as a new
 * chapter, preserving study progress (status/FSRS state lives on
 * study_items keyed by sentence, not on book_sentences, so repointing
 * book_id/chapter_id in place carries it across untouched) — then
 * soft-deletes the now-empty source book.
 *
 * Written for the class of bug diagnose-podcast-imported-books.ts and
 * check-duplicate-books.ts detect but don't fix: an episode/article that
 * should have joined a shared per-series book (commitSeriesEpisodeImport,
 * repository.ts) instead landed as its own one-off book — e.g. because the
 * import ran before the series-grouping feature existed, or the podcast
 * feed picker wasn't used for that episode. Also works as a general
 * "merge these two books" tool.
 *
 * If a source sentence already exists in the target book (rare — same
 * sentence content imported into both), the source's book_sentences row is
 * soft-deleted instead of moved (the target's copy, and its study
 * progress, wins) and reported so it can be checked by hand.
 *
 * Dry-run by default; --apply required to write.
 * Usage: npm run merge:book-into-chapter -- <sourceBookId> <targetBookId> [--chapter-title "..."] [--apply]
 */
import { createId } from '../src/lib/ids';
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type SupabaseClient = Awaited<ReturnType<typeof createScriptSupabaseClient>>;

interface BookChapterRow {
  id: string;
  title: string;
  position: number;
  sourceDate?: string;
  sourceId?: string;
}

interface BookRow {
  id: string;
  title: string;
  sourceKey: string | null;
  sourceUrl: string | null;
  chapters: BookChapterRow[];
  createdAt: string;
}

interface BookSentenceRow {
  id: string;
  sentenceId: string;
  position: number;
  status: string;
}

async function loadBook(supabase: SupabaseClient, ownerId: string, id: string): Promise<BookRow> {
  const { data, error } = await supabase
    .from('books')
    .select('id, title, source_key, source_url, chapters, created_at')
    .eq('owner_id', ownerId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch book ${id}: ${error.message}`);
  if (!data) throw new Error(`Book ${id} not found (or already deleted).`);
  return {
    id: String(data.id),
    title: String(data.title),
    sourceKey: data.source_key ? String(data.source_key) : null,
    sourceUrl: data.source_url ? String(data.source_url) : null,
    chapters: Array.isArray(data.chapters) ? (data.chapters as BookChapterRow[]) : [],
    createdAt: String(data.created_at),
  };
}

async function loadBookSentences(
  supabase: SupabaseClient,
  ownerId: string,
  bookId: string,
): Promise<BookSentenceRow[]> {
  const { data, error } = await supabase
    .from('book_sentences')
    .select('id, sentence_id, position, status')
    .eq('owner_id', ownerId)
    .eq('book_id', bookId)
    .is('deleted_at', null)
    .order('position', { ascending: true });
  if (error) throw new Error(`Failed to fetch book_sentences for ${bookId}: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    sentenceId: String(row.sentence_id),
    position: Number(row.position),
    status: String(row.status),
  }));
}

function parseArgs(argv: string[]): { sourceBookId: string; targetBookId: string; chapterTitle?: string } {
  const chapterTitleIndex = argv.indexOf('--chapter-title');
  const chapterTitle = chapterTitleIndex !== -1 ? argv[chapterTitleIndex + 1] : undefined;
  const positional = argv.filter((arg, i) => {
    if (arg === '--apply') return false;
    if (arg === '--chapter-title') return false;
    if (chapterTitleIndex !== -1 && i === chapterTitleIndex + 1) return false;
    return true;
  });
  const [sourceBookId, targetBookId] = positional;
  if (!sourceBookId || !targetBookId) {
    throw new Error(
      'Usage: tsx scripts/merge-book-into-chapter.ts <sourceBookId> <targetBookId> [--chapter-title "..."] [--apply]',
    );
  }
  return { sourceBookId, targetBookId, chapterTitle };
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const { sourceBookId, targetBookId, chapterTitle: chapterTitleOverride } = parseArgs(argv);

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const [source, target] = await Promise.all([
    loadBook(supabase, user.id, sourceBookId),
    loadBook(supabase, user.id, targetBookId),
  ]);
  if (source.id === target.id) throw new Error('Source and target book are the same.');

  const [sourceSentences, targetSentences] = await Promise.all([
    loadBookSentences(supabase, user.id, source.id),
    loadBookSentences(supabase, user.id, target.id),
  ]);

  const targetSentenceIds = new Set(targetSentences.map((row) => row.sentenceId));
  const maxTargetPosition = targetSentences.reduce((max, row) => Math.max(max, row.position), -1);

  const targetBySentenceId = new Map(targetSentences.map((row) => [row.sentenceId, row]));
  const toMove = sourceSentences.filter((row) => !targetSentenceIds.has(row.sentenceId));
  const collisions = sourceSentences.filter((row) => targetSentenceIds.has(row.sentenceId));
  // Only promote target's status when it's still untouched — anything else
  // (in_progress/complete/needs_review) reflects real study on the target's
  // own copy and must not be clobbered by the source's.
  const statusPromotions = collisions
    .map((row) => ({ source: row, target: targetBySentenceId.get(row.sentenceId)! }))
    .filter(({ source, target }) => target.status === 'unstarted' && source.status !== 'unstarted');

  const chapterTitle = (chapterTitleOverride ?? source.title).trim();
  const chapter: BookChapterRow = {
    id: createId('chapter'),
    title: chapterTitle,
    position: target.chapters.length,
    ...(source.sourceUrl || source.sourceKey ? { sourceId: source.sourceUrl ?? source.sourceKey! } : {}),
    ...(source.createdAt ? { sourceDate: source.createdAt } : {}),
  };

  console.log(
    `Merge "${source.title}" (${source.id}, ${sourceSentences.length} sentences) into "${target.title}" (${target.id})`,
  );
  console.log(`  new chapter: "${chapter.title}" (${chapter.id})`);
  console.log(`  ${toMove.length} sentence(s) will move, preserving status/study progress.`);
  if (collisions.length) {
    console.log(`  ${collisions.length} sentence(s) already exist in the target book — their source-book membership will be deleted, target's copy kept:`);
    for (const row of collisions) {
      const target = targetBySentenceId.get(row.sentenceId)!;
      const promoted = statusPromotions.some((p) => p.source.id === row.id);
      console.log(
        `    - book_sentences ${row.id} (sentence ${row.sentenceId}): source status "${row.status}", target status "${target.status}"${promoted ? ' -> target promoted to source status' : ''}`,
      );
    }
  }
  console.log(`  source book ${source.id} will be soft-deleted.`);

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
    return;
  }

  const { error: chapterError } = await supabase
    .from('books')
    .update({ chapters: [...target.chapters, chapter] })
    .eq('id', target.id);
  if (chapterError) throw new Error(`Failed to add chapter to ${target.id}: ${chapterError.message}`);

  for (let i = 0; i < toMove.length; i += 1) {
    const row = toMove[i]!;
    const { error } = await supabase
      .from('book_sentences')
      .update({ book_id: target.id, chapter_id: chapter.id, position: maxTargetPosition + 1 + i })
      .eq('id', row.id);
    if (error) throw new Error(`Failed to move book_sentence ${row.id}: ${error.message}`);
  }

  for (const { source, target } of statusPromotions) {
    const { error } = await supabase
      .from('book_sentences')
      .update({ status: source.status })
      .eq('id', target.id);
    if (error) throw new Error(`Failed to promote status on book_sentence ${target.id}: ${error.message}`);
  }

  for (const row of collisions) {
    const { error } = await supabase
      .from('book_sentences')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) throw new Error(`Failed to delete redundant book_sentence ${row.id}: ${error.message}`);
  }

  const { error: deleteError } = await supabase
    .from('books')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', source.id);
  if (deleteError) throw new Error(`Failed to delete source book ${source.id}: ${deleteError.message}`);

  console.log(`\nDone. Moved ${toMove.length} sentence(s), deleted ${collisions.length} redundant link(s), soft-deleted source book ${source.id}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
