/**
 * Repairs chapters flagged "out of recording order" by
 * `check:sentence-integrity` (src/lib/sentenceIntegrity.ts): a shared line
 * (an intro greeting / outro sign-off reused across episodes) whose
 * BookSentence row sits at a position from another episode, so it plays out
 * of order within its own chapter.
 *
 * Minimal, in-place fix: per flagged chapter, the rows that have a clip for
 * the chapter's own recording are re-sorted by that clip's start time and
 * handed back the position values the chapter already owned (ascending).
 * Rows without a clip for this recording keep their position. No other
 * chapter and no unrelated row is touched, and no position outside the set
 * the chapter already held is introduced.
 *
 * Dry-run by default; --apply required to write. Each update is guarded on
 * the row's current position, so a concurrent edit makes it a no-op rather
 * than an overwrite.
 * Usage: npm run repair:chapter-recording-order [-- --apply] [--chapter <chapterId>]
 */
import { findIntegrityProblems, type IntegrityClip, type IntegrityMembership, type IntegritySentence } from '../src/lib/sentenceIntegrity';
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type SupabaseClient = Awaited<ReturnType<typeof createScriptSupabaseClient>>;

const PAGE = 1000;

async function fetchAllRows<T>(supabase: SupabaseClient, table: string, columns: string, ownerId: string, liveOnly: boolean): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from(table).select(columns).eq('owner_id', ownerId);
    if (liveOnly) query = query.is('deleted_at', null);
    const { data, error } = await query.order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`);
    rows.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const chapterFlag = argv.indexOf('--chapter');
  const onlyChapter = chapterFlag >= 0 ? argv[chapterFlag + 1] : undefined;

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const [memberships, sentences, clips] = await Promise.all([
    fetchAllRows<IntegrityMembership>(supabase, 'book_sentences', 'id, book_id, sentence_id, chapter_id, position', user.id, true),
    fetchAllRows<IntegritySentence & { japanese: string }>(supabase, 'sentences', 'id, japanese, deleted_at', user.id, false),
    fetchAllRows<IntegrityClip>(supabase, 'reference_audio', 'id, sentence_id, source_id, source_start_ms', user.id, true),
  ]);
  const textOf = new Map(sentences.map((s) => [s.id, s.japanese.slice(0, 28)]));
  const report = findIntegrityProblems({ memberships, sentences, clips });

  const moves: { id: string; from: number; to: number }[] = [];
  for (const chapter of report.misorderedChapters) {
    if (onlyChapter && chapter.chapterId !== onlyChapter) continue;
    const rows = memberships.filter((m) => m.chapter_id === chapter.chapterId).sort((a, b) => a.position - b.position);
    const timed = rows.flatMap((m) => {
      const starts = clips.filter((c) => c.sentence_id === m.sentence_id && c.source_id === chapter.sourceId).map((c) => c.source_start_ms);
      return starts.length ? [{ row: m, start: Math.min(...starts) }] : [];
    });
    const slots = timed.map((t) => t.row.position); // already ascending
    const ordered = [...timed].sort((a, b) => a.start - b.start || a.row.position - b.row.position);
    console.log(`\n${chapter.chapterId} (${chapter.sourceId}): ${rows.length} rows, ${timed.length} timed`);
    ordered.forEach((t, i) => {
      const to = slots[i]!;
      if (to === t.row.position) return;
      moves.push({ id: t.row.id, from: t.row.position, to });
    });
    const chapterMoves = moves.filter((m) => rows.some((r) => r.id === m.id));
    // Report only the sentences that moved the most — shared lines — plus a count.
    const bySpan = chapterMoves
      .map((m) => ({ ...m, text: textOf.get(rows.find((r) => r.id === m.id)!.sentence_id) ?? '' }))
      .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
    console.log(`  ${chapterMoves.length} row(s) change position; largest moves:`);
    for (const m of bySpan.slice(0, 3)) console.log(`    ${m.from} -> ${m.to}  ${m.text}`);
  }

  console.log(`\n${moves.length} position update(s) in total.`);
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
    return;
  }
  for (const move of moves) {
    const { data, error } = await supabase
      .from('book_sentences')
      .update({ position: move.to })
      .eq('id', move.id)
      .eq('position', move.from)
      .select('id');
    if (error) throw new Error(`Failed to update ${move.id}: ${error.message}`);
    if (!data?.length) console.warn(`  skipped ${move.id}: position is no longer ${move.from}`);
  }
  console.log('Done. Re-run npm run check:sentence-integrity to confirm.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
