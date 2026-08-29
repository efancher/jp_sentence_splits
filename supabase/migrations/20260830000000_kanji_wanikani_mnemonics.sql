-- WaniKani meaning/reading mnemonics + hints for a kanji character, filled by
-- re-running the catalog importer (scripts/import-wanikani-kanji.ts). Hints
-- are one-line reinforcements and exist only on WaniKani kanji subjects, not
-- vocabulary. Surfaced only as a fallback on review cards (ReviewPage's
-- CardMnemonic) when the word under study has no WaniKani vocab mnemonic.
-- Additive, nullable — existing rows stay blank until the importer re-runs.
alter table public.kanji
  add column meaning_mnemonic text,
  add column meaning_hint text,
  add column reading_mnemonic text,
  add column reading_hint text;
