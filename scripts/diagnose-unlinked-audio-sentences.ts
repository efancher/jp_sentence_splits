/**
 * Read-only: how many sentences with a reference audio clip have no sentence_vocabulary links, split by
 * book and by whether the vocabulary step was confirmed. Phrase shadowing targets a linked word, so an
 * unlinked sentence can only get an arbitrary chunk.
 *
 * Usage: npm run diagnose:unlinked-audio-sentences
 */
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function main() {
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const ids = (table: string, column: string) =>
    fetchAll<string>(supabase, table, column, user.id, (r) => String(r[column]));
  const [audioIds, linkedIds] = await Promise.all([ids('reference_audio', 'sentence_id'), ids('sentence_vocabulary', 'sentence_id')]);
  const linked = new Set(linkedIds);
  const withAudio = [...new Set(audioIds)];
  const unlinked = withAudio.filter((id) => !linked.has(id));
  console.log(`Sentences with audio: ${withAudio.length}; without any vocabulary link: ${unlinked.length}`);

  const bookSentences = await fetchAll<{ sentenceId: string; bookId: string }>(
    supabase, 'book_sentences', 'sentence_id,book_id', user.id,
    (r) => ({ sentenceId: String(r.sentence_id), bookId: String(r.book_id) }),
  );
  const books = await fetchAll<{ id: string; title: string }>(
    supabase, 'books', 'id,title', user.id, (r) => ({ id: String(r.id), title: String(r.title) }),
  );
  const titleById = new Map(books.map((b) => [b.id, b.title]));
  const bookBySentence = new Map(bookSentences.map((b) => [b.sentenceId, b.bookId]));
  const perBook = new Map<string, { audio: number; unlinked: number }>();
  for (const id of withAudio) {
    const key = titleById.get(bookBySentence.get(id) ?? '') ?? '(no book)';
    const row = perBook.get(key) ?? { audio: 0, unlinked: 0 };
    row.audio += 1;
    if (!linked.has(id)) row.unlinked += 1;
    perBook.set(key, row);
  }
  for (const [title, row] of [...perBook].sort((a, b) => b[1].unlinked - a[1].unlinked)) {
    console.log(`${String(row.unlinked).padStart(4)} / ${String(row.audio).padEnd(4)} ${title}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
