/**
 * Repairs a podcast-series book's episode chapters against the ground truth
 * of each sentence's own per-episode `SentenceAudio`/`reference_audio` clip
 * timing (`commitSeriesEpisodeImport`, `src/db/repository.ts`).
 *
 * Two related corruptions this fixes, both rooted in the same cause — a
 * line reused verbatim across episodes (a podcast's boilerplate intro/outro,
 * e.g. "またね。") dedupes to one shared `Sentence` row, and pre-fix import
 * code treated a book as holding only one membership per Sentence:
 *
 *  1. **Scrambled order.** The reused line's `firstOccurrenceIndex` freezes
 *     at whichever episode *first* created it (`mergeSentenceOnReimport`
 *     never updates it on reimport); sorting a new episode's chapter by that
 *     stale, foreign index mixed with its own correctly-computed ones
 *     scrambled the result.
 *  2. **Missing sentences.** Every reimport that reused the line dragged the
 *     *one* BookSentence row over to its own new chapter, leaving every
 *     other episode that also spoke that line silently missing it.
 *
 * Both fixed going forward in `commitSeriesEpisodeImport`/
 * `attachSentencesToChapterForImport` (2026-09-26): a new episode's own
 * order is re-derived immediately after commit, and a reused sentence now
 * gets its own BookSentence row per chapter instead of being dragged away.
 * This script repairs chapters written before that fix.
 *
 * Repair source of truth: `reference_audio.source_start_ms`, scoped per
 * chapter by matching the clip's own `source_id` ("source-<uuid>") against
 * the chapter's `sourceId` (the RSS episode/enclosure URL, which embeds the
 * same media-file UUID) — per-episode and immune to the cross-episode
 * Sentence-level corruption. For each chapter: any sentence with its own
 * clip for that episode but no current membership row there gets one
 * created (never deletes or moves an existing row — a shared line keeps
 * belonging everywhere it already does, this only adds what's missing).
 * Every chapter's sentences are then ordered by that episode's own
 * start-time, and every chapter in the book is renumbered sequentially in
 * chapter order (`Book.chapters[].position`) — a full, deliberate
 * renumbering rather than an in-place permutation, since backfilling can
 * change how many sentences a chapter holds. Unassigned (no `chapterId`)
 * memberships are left untouched and appended after, in their existing
 * relative order. Skips (rather than guesses at) a chapter with zero
 * reference-audio coverage — nothing to repair against.
 *
 * Dry-run by default; --apply required to write.
 * Usage: npm run repair:episode-sentence-order -- <bookId> [--apply]
 *
 * Applied 2026-09-26 to "Slow Japanese" (book_5c1ab5fd-c7cb-46c5-b931-d89887a7f2f7):
 * first pass (order only) fixed Episode #2 (Family), #4 (Hobby), #160
 * (restaurants); this backfill-capable version then restored 25
 * missing-sentence instances across all 7 chapters (mostly shared
 * intro/outro lines) and renumbered the whole book.
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';
import { createId } from '../src/lib/ids';

type SupabaseClient = Awaited<ReturnType<typeof createScriptSupabaseClient>>;

interface ChapterRow {
  id: string;
  title: string;
  position: number;
  sourceId?: string;
}

interface MembershipRow {
  id: string;
  sentence_id: string;
  chapter_id: string | null;
  position: number;
}

async function fetchAllReferenceAudio(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<{ sentence_id: string; source_id: string; source_start_ms: number }[]> {
  const pageSize = 1000;
  const out: { sentence_id: string; source_id: string; source_start_ms: number }[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('reference_audio')
      .select('sentence_id, source_id, source_start_ms')
      .eq('owner_id', ownerId)
      .is('deleted_at', null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to fetch reference_audio: ${error.message}`);
    out.push(
      ...(data ?? []).map((row) => ({
        sentence_id: String(row.sentence_id),
        source_id: String(row.source_id),
        source_start_ms: Number(row.source_start_ms),
      })),
    );
    if (!data || data.length < pageSize) break;
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const bookId = argv.find((arg) => arg !== '--apply');
  if (!bookId) {
    throw new Error('Usage: tsx scripts/repair-episode-sentence-order.ts <bookId> [--apply]');
  }

  const supabase: SupabaseClient = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const { data: book, error: bookError } = await supabase
    .from('books')
    .select('id, title, chapters')
    .eq('owner_id', user.id)
    .eq('id', bookId)
    .is('deleted_at', null)
    .maybeSingle();
  if (bookError) throw new Error(`Failed to fetch book: ${bookError.message}`);
  if (!book) throw new Error(`Book ${bookId} not found.`);
  const chapters = ((book.chapters ?? []) as ChapterRow[])
    .slice()
    .sort((a, b) => a.position - b.position);
  console.log(`Book: ${book.title} (${book.id}), ${chapters.length} chapter(s)`);

  const { data: membershipsRaw, error: memErr } = await supabase
    .from('book_sentences')
    .select('id, sentence_id, chapter_id, position')
    .eq('owner_id', user.id)
    .eq('book_id', book.id)
    .is('deleted_at', null);
  if (memErr) throw new Error(`Failed to fetch book_sentences: ${memErr.message}`);
  const memberships = (membershipsRaw ?? []) as MembershipRow[];

  const allAudio = await fetchAllReferenceAudio(supabase, user.id);
  const timestamp = new Date().toISOString();

  const orderedRowsForBook: { id: string; chapter_id: string | null }[] = [];
  const newRows: {
    id: string;
    book_id: string;
    sentence_id: string;
    chapter_id: string;
    position: number;
    status: string;
    added_at: string;
    owner_id: string;
  }[] = [];

  for (const chapter of chapters) {
    if (!chapter.sourceId) continue;
    const episodeAudio = allAudio.filter((row) =>
      chapter.sourceId!.includes(row.source_id.replace(/^source-/, '')),
    );
    if (!episodeAudio.length) {
      console.log(`${chapter.title}: no reference-audio coverage, skipping.`);
      continue;
    }

    const current = memberships.filter((m) => m.chapter_id === chapter.id);
    const currentSentenceIds = new Set(current.map((m) => m.sentence_id));
    const missing = episodeAudio.filter((row) => !currentSentenceIds.has(row.sentence_id));

    if (missing.length) {
      console.log(`${chapter.title}: backfilling ${missing.length} missing sentence(s).`);
    }
    const missingRows = missing.map((row) => ({
      id: createId('bs'),
      book_id: book.id,
      sentence_id: row.sentence_id,
      chapter_id: chapter.id,
      position: 0, // reassigned below
      status: 'unstarted',
      added_at: timestamp,
      owner_id: user.id,
    }));
    newRows.push(...missingRows);

    const startMsBySentence = new Map(episodeAudio.map((row) => [row.sentence_id, row.source_start_ms]));
    const allRowsForChapter: { id: string; sentence_id: string }[] = [
      ...current.map((m) => ({ id: m.id, sentence_id: m.sentence_id })),
      ...missingRows.map((r) => ({ id: r.id, sentence_id: r.sentence_id })),
    ];
    // Sentences without their own clip for this episode (shouldn't normally
    // happen given the earlier coverage check, but keep their relative
    // position rather than crashing) sort after the timed ones.
    allRowsForChapter.sort((a, b) => {
      const ta = startMsBySentence.get(a.sentence_id);
      const tb = startMsBySentence.get(b.sentence_id);
      if (ta === undefined && tb === undefined) return 0;
      if (ta === undefined) return 1;
      if (tb === undefined) return -1;
      return ta - tb;
    });
    orderedRowsForBook.push(
      ...allRowsForChapter.map((row) => ({ id: row.id, chapter_id: chapter.id })),
    );
  }

  const touchedChapterIds = new Set(chapters.filter((c) => c.sourceId).map((c) => c.id));
  const untouched = memberships
    .filter((m) => !m.chapter_id || !touchedChapterIds.has(m.chapter_id))
    .sort((a, b) => a.position - b.position)
    .map((m) => ({ id: m.id, chapter_id: m.chapter_id }));
  const fullOrder = [...orderedRowsForBook, ...untouched];

  console.log(`\n${newRows.length} sentence(s) to backfill across the book.`);
  console.log(`Renumbering ${fullOrder.length} membership row(s) total.`);

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
    return;
  }

  if (newRows.length) {
    const { error } = await supabase.from('book_sentences').insert(newRows);
    if (error) throw new Error(`Failed to insert backfilled rows: ${error.message}`);
  }
  for (let i = 0; i < fullOrder.length; i += 1) {
    const { error } = await supabase
      .from('book_sentences')
      .update({ position: i })
      .eq('id', fullOrder[i]!.id);
    if (error) throw new Error(`Failed to update position for ${fullOrder[i]!.id}: ${error.message}`);
  }
  console.log('\nDone.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
