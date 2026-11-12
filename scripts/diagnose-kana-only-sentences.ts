/**
 * Read-only: lists sentences whose Japanese is entirely kana (no kanji, no
 * digits/Latin), grouped by source. Slow learner speech used to come back
 * from ASR as hiragana (docs/STATUS.md 2026-11-05, fixed by Whisper hotwords);
 * earlier imports were never scanned. A kana-only line is not necessarily
 * wrong (あいさつ, よろしく), so the output is a triage list: the longer the
 * line, the likelier it lost its kanji. Fix hits with
 * `scripts/restore-kanji-sentences.ts` (explicit substitutions file).
 *
 * Usage: npx tsx scripts/diagnose-kana-only-sentences.ts [--min-length 8]
 */
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const KANA_ONLY = /^[\p{Script=Hiragana}\p{Script=Katakana}ー〜、。！？!?「」…\s]+$/u;

function minLength(argv: string[]): number {
  const i = argv.indexOf('--min-length');
  return i >= 0 ? Number(argv[i + 1]) || 8 : 8;
}

async function main() {
  const min = minLength(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const sentences = await fetchAll<{ id: string; japanese: string }>(
    supabase,
    'sentences',
    'id, japanese',
    user.id,
    (row) => ({ id: String(row.id), japanese: String(row.japanese ?? '') }),
  );
  const hits = sentences.filter(
    (s) => KANA_ONLY.test(s.japanese.trim()) && s.japanese.trim().length >= min,
  );
  console.log(`${sentences.length} sentences; ${hits.length} kana-only with length >= ${min}.`);

  const books = await fetchAll<{ id: string; title: string }>(
    supabase,
    'books',
    'id, title',
    user.id,
    (row) => ({ id: String(row.id), title: String(row.title ?? '') }),
  );
  const titleById = new Map(books.map((b) => [b.id, b.title]));
  const links = await fetchAll<{ sentenceId: string; bookId: string }>(
    supabase,
    'book_sentences',
    'sentence_id, book_id',
    user.id,
    (row) => ({ sentenceId: String(row.sentence_id), bookId: String(row.book_id) }),
    'sentence_id',
  );
  const bookBySentence = new Map(links.map((l) => [l.sentenceId, l.bookId]));

  const byBook = new Map<string, typeof hits>();
  for (const hit of hits) {
    const key = titleById.get(bookBySentence.get(hit.id) ?? '') ?? '(no book)';
    byBook.set(key, [...(byBook.get(key) ?? []), hit]);
  }
  for (const [title, rows] of [...byBook].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${title} (${rows.length})`);
    for (const row of rows.slice(0, 5)) console.log(`  ${row.id}  ${row.japanese}`);
    if (rows.length > 5) console.log(`  … ${rows.length - 5} more`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
