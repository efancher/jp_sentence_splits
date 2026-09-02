-- Retires the WaniKani mnemonic feature (see docs/STATUS.md). The "Show
-- mnemonic" scaffolding on ReviewPage, the MnemonicText renderer, and both
-- ingestion scripts (import-wanikani-kanji.ts, backfill-wanikani-mnemonics.ts)
-- are gone; learning-in-context replaces it. Drops the now-unused columns
-- added by 20260829/20260830 and the script-only subject cache from
-- 20260831. The 'mnemonic_shown' review-assistance value is deliberately
-- kept (historical reviews still carry it).
alter table public.vocabulary_items
  drop column if exists meaning_mnemonic,
  drop column if exists reading_mnemonic;

alter table public.kanji
  drop column if exists meaning_mnemonic,
  drop column if exists meaning_hint,
  drop column if exists reading_mnemonic,
  drop column if exists reading_hint;

drop table if exists public.wanikani_subjects;
