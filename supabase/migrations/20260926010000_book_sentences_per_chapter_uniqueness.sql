-- Replaces the single (book_id, sentence_id) uniqueness constraint with two
-- narrower ones, so a sentence can belong to more than one chapter of the
-- same book — needed for a podcast-series book whose episodes reuse an
-- exact boilerplate line (an intro/outro sign-off): each episode now gets
-- its own BookSentence row for that line (attachSentencesToChapterForImport,
-- src/db/repository.ts, 2026-09-26) instead of one episode's reimport
-- silently dragging the only row away from every other episode that also
-- speaks it. The old constraint already made that theft-not-duplication
-- behavior mandatory at the schema level; this migration is what actually
-- unblocks the app-level fix (which otherwise creates a second local row
-- that can never sync up). See docs/STATUS.md 2026-09-26.
--
-- Uniqueness after this migration:
--   - (book_id, chapter_id, sentence_id) when chapter_id is set — a
--     sentence can't duplicate within the *same* chapter (a re-import of
--     the same episode still updates in place), but can appear once per
--     *different* chapter.
--   - (book_id, sentence_id) when chapter_id is null — every non-chaptered
--     book (the vast majority: Satori CSV imports, single-source shadowing
--     imports, etc.) keeps today's exact one-row-per-sentence guarantee.
drop index if exists public.book_sentences_book_sentence_uidx;

create unique index book_sentences_book_chapter_sentence_uidx
  on public.book_sentences (book_id, chapter_id, sentence_id)
  where deleted_at is null and chapter_id is not null;

create unique index book_sentences_book_sentence_unchaptered_uidx
  on public.book_sentences (book_id, sentence_id)
  where deleted_at is null and chapter_id is null;
