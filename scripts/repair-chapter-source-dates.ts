/**
 * Replaces a podcast-series book's chapter `sourceDate`s with the feed's
 * real pubDate (some chapters were imported with the import-time fallback
 * date because no episode date was in hand), then re-sorts the chapters
 * chronologically and renumbers `Book.chapters[].position`.
 *
 * Chapters are matched to feed items on the canonical media URL
 * (`canonicalSourceId`). Run `repair:episode-sentence-order -- <bookId>
 * --apply` afterwards to renumber the book's sentence positions to the new
 * chapter order.
 *
 * Dry-run by default; --apply required to write.
 * Usage: npm run repair:chapter-source-dates -- <bookId> [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';
import { canonicalSourceId } from '../src/lib/ids';

interface ChapterRow {
  id: string;
  title: string;
  position: number;
  sourceId?: string;
  sourceDate?: string;
  [key: string]: unknown;
}

async function fetchFeedDates(feedUrl: string): Promise<Map<string, string>> {
  const res = await fetch(feedUrl, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`);
  const xml = await res.text();
  const dates = new Map<string, string>();
  for (const item of xml.split('<item>').slice(1)) {
    const enclosure = /<enclosure[^>]*\burl="([^"]+)"/.exec(item)?.[1];
    const pubDate = /<pubDate>([^<]+)<\/pubDate>/.exec(item)?.[1];
    if (!enclosure || !pubDate) continue;
    const parsed = new Date(pubDate.trim());
    if (Number.isNaN(parsed.getTime())) continue;
    dates.set(canonicalSourceId(enclosure.replace(/&amp;/g, '&')), parsed.toISOString());
  }
  return dates;
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const bookId = argv.find((arg) => arg !== '--apply');
  if (!bookId) throw new Error('Usage: tsx scripts/repair-chapter-source-dates.ts <bookId> [--apply]');

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const { data: book, error } = await supabase
    .from('books')
    .select('id, title, source_url, chapters, version')
    .eq('owner_id', user.id)
    .eq('id', bookId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch book: ${error.message}`);
  if (!book) throw new Error(`Book ${bookId} not found.`);
  if (!book.source_url) throw new Error('Book has no source_url (feed URL).');

  const feedDates = await fetchFeedDates(book.source_url as string);
  console.log(`Feed: ${feedDates.size} dated episode(s).`);

  const chapters = (book.chapters ?? []) as ChapterRow[];
  const next = chapters.map((chapter) => {
    const date = chapter.sourceId ? feedDates.get(canonicalSourceId(chapter.sourceId)) : undefined;
    if (!date) {
      console.log(`  no feed match, left as-is: ${chapter.title} (${chapter.sourceDate ?? 'no date'})`);
      return chapter;
    }
    if (date !== chapter.sourceDate) {
      console.log(`  ${chapter.title}: ${chapter.sourceDate ?? 'none'} -> ${date}`);
    }
    return { ...chapter, sourceDate: date };
  });

  const dated = next.filter((c) => c.sourceDate).sort((a, b) => a.sourceDate!.localeCompare(b.sourceDate!));
  const undated = next.filter((c) => !c.sourceDate);
  const sorted = [...dated, ...undated].map((chapter, position) => ({ ...chapter, position }));
  console.log('\nNew order:');
  for (const c of sorted) console.log(`  ${c.position}. ${c.title} (${c.sourceDate ?? 'no date'})`);

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
    return;
  }
  const { error: updateError } = await supabase
    .from('books')
    .update({ chapters: sorted, updated_at: new Date().toISOString(), version: Number(book.version ?? 1) + 1 })
    .eq('id', book.id);
  if (updateError) throw new Error(`Failed to update book: ${updateError.message}`);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
