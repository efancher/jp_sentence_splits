/**
 * Read-only integrity check for sentence membership, scoped to the signed-in
 * owner. Flags (see src/lib/sentenceIntegrity.ts):
 *   - dangling memberships: a live book_sentences row whose sentence is
 *     soft-deleted or missing (the Reader silently skips it, leaving a hole);
 *   - orphan clips: a live reference_audio row for a deleted sentence (the
 *     repair-episode-sentence-order backfill trusted these and re-created
 *     memberships for deleted sentences);
 *   - duplicate positions within one (book, chapter);
 *   - misordered chapters: sentences not in the order their own recording plays.
 * A sentence with live memberships in several chapters is normal (a reused
 * intro/outro line) and is not reported.
 *
 * Usage: npm run check:sentence-integrity   (exits 1 if anything is found)
 * Never writes. Repairs live in scripts/repair-dangling-sentence-rows.ts.
 */
import { findIntegrityProblems, type IntegrityClip, type IntegrityMembership, type IntegritySentence } from '../src/lib/sentenceIntegrity';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const PAGE = 1000;

async function fetchAll<T>(
  supabase: Awaited<ReturnType<typeof createScriptSupabaseClient>>,
  table: string,
  columns: string,
  ownerId: string,
  liveOnly: boolean,
): Promise<T[]> {
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
  const supabase = await createScriptSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Signed in but no user on session — unexpected.');

  const [memberships, sentences, clips, books] = await Promise.all([
    fetchAll<IntegrityMembership>(supabase, 'book_sentences', 'id, book_id, sentence_id, chapter_id, position', user.id, true),
    fetchAll<IntegritySentence & { japanese: string }>(supabase, 'sentences', 'id, japanese, deleted_at', user.id, false),
    fetchAll<IntegrityClip>(supabase, 'reference_audio', 'id, sentence_id, source_id, source_start_ms', user.id, true),
    fetchAll<{ id: string; title: string }>(supabase, 'books', 'id, title', user.id, true),
  ]);
  const titleOf = new Map(books.map((b) => [b.id, b.title]));
  const textOf = new Map(sentences.map((s) => [s.id, s.japanese.slice(0, 24)]));
  const report = findIntegrityProblems({ memberships, sentences, clips });
  let problems = 0;

  if (report.danglingMemberships.length) {
    problems += report.danglingMemberships.length;
    console.log(`\n${report.danglingMemberships.length} dangling membership(s):`);
    for (const m of report.danglingMemberships) {
      console.log(`  ${titleOf.get(m.book_id) ?? m.book_id} ch=${m.chapter_id ?? '-'} pos=${m.position} ${m.id} -> ${m.sentence_id} ${textOf.get(m.sentence_id) ?? '(missing)'}`);
    }
  }
  if (report.orphanClips.length) {
    problems += report.orphanClips.length;
    console.log(`\n${report.orphanClips.length} orphan clip(s) for deleted sentences:`);
    for (const c of report.orphanClips) console.log(`  ${c.id} -> ${c.sentence_id} ${c.source_id} @${c.source_start_ms}ms`);
  }
  if (report.duplicatePositions.length) {
    problems += report.duplicatePositions.length;
    console.log(`\n${report.duplicatePositions.length} duplicate position(s):`);
    for (const d of report.duplicatePositions) console.log(`  ${titleOf.get(d.bookId) ?? d.bookId} ch=${d.chapterId ?? '-'} pos=${d.position}`);
  }
  if (report.misorderedChapters.length) {
    problems += report.misorderedChapters.length;
    console.log(`\n${report.misorderedChapters.length} chapter(s) out of recording order:`);
    for (const c of report.misorderedChapters) {
      console.log(`  ${titleOf.get(c.bookId) ?? c.bookId} ch=${c.chapterId} (${c.sourceId}) ${c.inversions} inversion(s): ${c.sentenceIds.map((id) => textOf.get(id) ?? id).join(' | ')}`);
    }
  }

  if (!problems) {
    console.log(`Sentence membership is consistent (${memberships.length} live memberships, ${sentences.length} sentences).`);
    return;
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
