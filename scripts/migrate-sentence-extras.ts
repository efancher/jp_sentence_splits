/**
 * Moves the AI-drafted per-sentence blobs out of books.chapters[*]
 * (structureDrafts / constructionDrafts / contextWalkthroughs) into one
 * `sentence_extras` row per sentence, so a book row stays small.
 *
 * Two phases, both dry-run unless --apply:
 *   (default)  COPY  - insert a sentence_extras row for every sentence that has inline drafts and no
 *                      row yet. Never overwrites an existing row and never touches `books`. Idempotent.
 *   --strip    STRIP - remove the inline maps from each book's chapters, but only after verifying every
 *                      inline entry is present in sentence_extras (a book with any gap is skipped).
 *                      Uses the book's version for compare-and-swap. Run only once every device runs a
 *                      build that reads sentence_extras, and after taking a backup.
 *
 * Usage: npm run migrate:sentence-extras -- [--strip] [--apply] [--book <bookId>]
 */
import { parseApplyFlag, requireAuthedUser, upsertBatched } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const MAPS = ['structureDrafts', 'constructionDrafts', 'contextWalkthroughs'] as const;
type MapName = (typeof MAPS)[number];
const COLUMN: Record<MapName, string> = {
  structureDrafts: 'structure_draft',
  constructionDrafts: 'construction_draft',
  contextWalkthroughs: 'context_walkthrough',
};

interface Chapter {
  id: string;
  structureDrafts?: Record<string, unknown>;
  constructionDrafts?: Record<string, unknown>;
  contextWalkthroughs?: Record<string, unknown>;
  [key: string]: unknown;
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const strip = argv.includes('--strip');
  const bookFlag = argv.indexOf('--book');
  const onlyBook = bookFlag >= 0 ? argv[bookFlag + 1] : undefined;

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  let query = supabase.from('books').select('id').eq('owner_id', user.id).is('deleted_at', null);
  if (onlyBook) query = query.eq('id', onlyBook);
  const { data: bookIds, error: listError } = await query;
  if (listError) throw new Error(`Failed to list books: ${listError.message}`);

  let copied = 0;
  let stripped = 0;
  let skipped = 0;
  for (const { id: bookId } of bookIds ?? []) {
    // One book at a time: a single row can be several MB.
    const { data: book, error } = await supabase
      .from('books')
      .select('id, title, chapters, version')
      .eq('owner_id', user.id)
      .eq('id', bookId)
      .single();
    if (error) throw new Error(`Failed to fetch book ${bookId}: ${error.message}`);
    const chapters = (book.chapters ?? []) as Chapter[];

    const inline = new Map<string, { chapterId: string; fields: Partial<Record<MapName, unknown>> }>();
    for (const chapter of chapters) {
      for (const name of MAPS) {
        for (const [sentenceId, value] of Object.entries(chapter[name] ?? {})) {
          const entry = inline.get(sentenceId) ?? { chapterId: chapter.id, fields: {} };
          entry.fields[name] = value;
          inline.set(sentenceId, entry);
        }
      }
    }
    if (inline.size === 0) continue;

    const existing = new Map<string, Record<string, unknown>>();
    const ids = [...inline.keys()];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error: extrasError } = await supabase
        .from('sentence_extras')
        .select('id, structure_draft, construction_draft, context_walkthrough')
        .eq('owner_id', user.id)
        .is('deleted_at', null)
        .in('id', ids.slice(i, i + 200));
      if (extrasError) throw new Error(`Failed to fetch sentence_extras: ${extrasError.message}`);
      for (const row of data ?? []) existing.set(String(row.id), row);
    }

    if (!strip) {
      const rows = ids
        .filter((id) => !existing.has(id))
        .map((id) => {
          const { chapterId, fields } = inline.get(id)!;
          return {
            id,
            owner_id: user.id,
            book_id: bookId,
            chapter_id: chapterId,
            structure_draft: fields.structureDrafts ?? null,
            construction_draft: fields.constructionDrafts ?? null,
            context_walkthrough: fields.contextWalkthroughs ?? null,
          };
        });
      console.log(`${book.title}: ${inline.size} sentences with inline drafts, ${rows.length} to copy.`);
      if (apply && rows.length > 0) await upsertBatched(supabase, 'sentence_extras', rows, 'id');
      copied += rows.length;
      continue;
    }

    const gaps = ids.filter((id) => {
      const have = existing.get(id);
      if (!have) return true;
      return MAPS.some((name) => inline.get(id)!.fields[name] !== undefined && have[COLUMN[name]] == null);
    });
    if (gaps.length > 0) {
      console.log(`${book.title}: SKIPPED - ${gaps.length} inline sentence(s) are not fully in sentence_extras; run the copy phase first.`);
      skipped += 1;
      continue;
    }
    const slim = chapters.map((chapter) => {
      const next = { ...chapter };
      for (const name of MAPS) delete next[name];
      return next;
    });
    const before = JSON.stringify(chapters).length;
    const after = JSON.stringify(slim).length;
    console.log(`${book.title}: strip ${inline.size} sentences, chapters ${(before / 1e6).toFixed(2)} MB -> ${(after / 1e6).toFixed(2)} MB.`);
    if (apply) {
      const { data: updated, error: updateError } = await supabase
        .from('books')
        .update({ chapters: slim })
        .eq('id', bookId)
        .eq('owner_id', user.id)
        .eq('version', Number(book.version))
        .select('id');
      if (updateError) throw new Error(`Failed to strip ${bookId}: ${updateError.message}`);
      if (!updated || updated.length === 0) {
        console.log('  version moved underneath us; skipped, re-run.');
        skipped += 1;
        continue;
      }
    }
    stripped += 1;
  }

  const verb = apply ? '' : ' (dry run - re-run with --apply)';
  console.log(strip ? `\nStripped ${stripped} book(s), skipped ${skipped}.${verb}` : `\nCopied ${copied} sentence_extras row(s).${verb}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
