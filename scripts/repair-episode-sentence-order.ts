/**
 * Repairs a scrambled BookSentence.position order within one or more
 * chapters of a podcast-series book (commitSeriesEpisodeImport,
 * repository.ts).
 *
 * Root cause (found via a user report that ReaderPage's playback order
 * didn't match the podcast — see docs/STATUS.md 2026-09-26): a line reused
 * verbatim across episodes (a boilerplate intro/outro sentence) dedupes to
 * one shared `Sentence` row, whose `firstOccurrenceIndex` is frozen at
 * whichever episode *first* created it (`mergeSentenceOnReimport` never
 * updates it on reimport). `addSentencesToBook`'s `first_occurrence` sort
 * then mixes that stale, foreign index with the correctly-computed indices
 * of the episode's own unique lines, scrambling the chapter. Fixed going
 * forward in `commitSeriesEpisodeImport` itself (it now re-derives each new
 * episode's own order immediately after commit); this script repairs
 * chapters that were already written before that fix.
 *
 * Repair source of truth: each sentence's own `SentenceAudio`/
 * `reference_audio` clip for *this specific episode* — `source_start_ms`,
 * scoped by matching the clip's own `source_id` ("source-<uuid>") against
 * the chapter's `sourceId` (the RSS episode/enclosure URL, which embeds the
 * same media-file UUID) — is per-episode and immune to the cross-import
 * reuse that corrupted `firstOccurrenceIndex`. Only rewrites `position`;
 * every other field (status, chapterId, analysis, etc.) is untouched. Only
 * touches a chapter where every one of its sentences has its own audio clip
 * for that episode (no guessing at partial coverage) and only reassigns
 * *among that chapter's own existing position values* (a permutation, not a
 * renumbering), so it can't disturb any other chapter's block in the book.
 *
 * Dry-run by default; --apply required to write.
 * Usage: npm run repair:episode-sentence-order -- <bookId> [--apply]
 *
 * Applied 2026-09-26 to "Slow Japanese" (book_5c1ab5fd-c7cb-46c5-b931-d89887a7f2f7):
 * repaired Episode #2 (Family), #4 (Hobby), #160 (restaurants). Checked
 * every other multi-chapter podcast-series book at the same time — none
 * were both scrambled and fully audio-covered enough to safely repair.
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type SupabaseClient = Awaited<ReturnType<typeof createScriptSupabaseClient>>;

interface ChapterRow {
  id: string;
  title: string;
  sourceId?: string;
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
  const chapters = (book.chapters ?? []) as ChapterRow[];
  console.log(`Book: ${book.title} (${book.id}), ${chapters.length} chapter(s)`);

  let anyChanged = false;
  for (const chapter of chapters) {
    if (!chapter.sourceId) continue;

    const { data: memberships, error: memErr } = await supabase
      .from('book_sentences')
      .select('id, sentence_id, position')
      .eq('owner_id', user.id)
      .eq('book_id', book.id)
      .eq('chapter_id', chapter.id)
      .is('deleted_at', null);
    if (memErr) throw new Error(`Failed to fetch book_sentences: ${memErr.message}`);
    if (!memberships?.length) continue;

    const sentenceIds = memberships.map((m) => String(m.sentence_id));
    const { data: audioAll, error: audioErr } = await supabase
      .from('reference_audio')
      .select('sentence_id, source_id, source_start_ms')
      .eq('owner_id', user.id)
      .is('deleted_at', null)
      .in('sentence_id', sentenceIds);
    if (audioErr) throw new Error(`Failed to fetch reference_audio: ${audioErr.message}`);

    const episodeAudio = (audioAll ?? []).filter((row) =>
      chapter.sourceId!.includes(String(row.source_id).replace(/^source-/, '')),
    );
    if (episodeAudio.length !== sentenceIds.length) {
      console.log(
        `${chapter.title}: skipping — only ${episodeAudio.length}/${sentenceIds.length} sentences have this episode's own audio clip.`,
      );
      continue;
    }

    const startMsBySentence = new Map(
      episodeAudio.map((row) => [String(row.sentence_id), Number(row.source_start_ms)]),
    );
    // The set of position *values* this chapter currently occupies stays
    // fixed (a permutation, not a renumbering) — that's what keeps this
    // repair from disturbing any other chapter's block in the book.
    const currentPositions = memberships.map((m) => Number(m.position)).sort((a, b) => a - b);
    const currentOrderIds = [...memberships]
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map((m) => String(m.sentence_id));
    const trueOrderIds = [...sentenceIds].sort(
      (a, b) => startMsBySentence.get(a)! - startMsBySentence.get(b)!,
    );

    if (JSON.stringify(currentOrderIds) === JSON.stringify(trueOrderIds)) {
      console.log(`${chapter.title}: already correct.`);
      continue;
    }

    console.log(`${chapter.title}: SCRAMBLED — repairing ${sentenceIds.length} sentence(s).`);
    anyChanged = true;
    const bsIdBySentenceId = new Map(memberships.map((m) => [String(m.sentence_id), String(m.id)]));
    for (let i = 0; i < trueOrderIds.length; i += 1) {
      const sentenceId = trueOrderIds[i]!;
      const newPosition = currentPositions[i]!;
      const bsId = bsIdBySentenceId.get(sentenceId)!;
      console.log(`  position ${newPosition} <- sentence ${sentenceId}`);
      if (apply) {
        const { error } = await supabase
          .from('book_sentences')
          .update({ position: newPosition })
          .eq('id', bsId);
        if (error) throw new Error(`Failed to update book_sentence ${bsId}: ${error.message}`);
      }
    }
  }

  if (!anyChanged) {
    console.log('\nNo scrambled chapters found.');
  } else if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
  } else {
    console.log('\nDone.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
