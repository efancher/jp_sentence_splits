/**
 * Flags books that share an exact title (case/whitespace-insensitive),
 * scoped to the signed-in owner. Non-archived only — archiving is the
 * intentional way to retire a book without triggering this.
 *
 * Root cause this guards against: re-importing the same source (e.g. a CSV
 * paste) with "New book" chosen instead of "Add to existing book" silently
 * creates a second, fully separate `book_sentences` pool for identical
 * content. Nothing ever surfaces this — each copy is valid on its own, and
 * study progress just fragments across copies, invisibly stalling the
 * "N sentences waiting" figure. See docs/STATUS.md (2026-08-23) for the
 * incident this was written for.
 *
 * Usage: npm run check:duplicate-books
 * Exits 1 if any duplicates are found, so it can gate a workflow run.
 */
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function main() {
  const supabase = await createScriptSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Signed in but no user on session — unexpected.');

  const { data: books, error } = await supabase
    .from('books')
    .select('id, title, created_at, last_opened_at')
    .eq('owner_id', user.id)
    .eq('archived', false)
    .is('deleted_at', null);
  if (error) throw new Error(`Failed to fetch books: ${error.message}`);

  const byTitle = new Map<string, typeof books>();
  for (const book of books ?? []) {
    const key = normalizeTitle(book.title as string);
    const list = byTitle.get(key);
    if (list) list.push(book);
    else byTitle.set(key, [book]);
  }

  const duplicateGroups = [...byTitle.values()].filter((group) => group!.length > 1);
  if (!duplicateGroups.length) {
    console.log(`No duplicate book titles (${books?.length ?? 0} books checked).`);
    return;
  }

  console.log(`${duplicateGroups.length} title(s) with duplicate books:\n`);
  for (const group of duplicateGroups) {
    console.log(`"${group![0]!.title}" — ${group!.length} copies:`);
    for (const book of group!) {
      const bookSentences = await supabase
        .from('book_sentences')
        .select('status', { count: 'exact', head: false })
        .eq('book_id', book.id as string);
      const counts: Record<string, number> = {};
      for (const row of bookSentences.data ?? []) {
        counts[row.status as string] = (counts[row.status as string] ?? 0) + 1;
      }
      console.log(
        `  - [${book.id}] created ${book.created_at}, last_opened_at ${book.last_opened_at ?? 'never'}, sentences: ${JSON.stringify(counts)}`,
      );
    }
    console.log('');
  }

  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
