-- Marks a sentence the book assistant's grammar extra has already looked at, so a sentence with no
-- constructions to link is not sent again on every run. Nullable: absent = never checked.
alter table public.sentence_extras add column if not exists grammar_checked boolean;
