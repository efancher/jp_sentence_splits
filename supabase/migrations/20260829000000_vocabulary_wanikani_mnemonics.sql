-- WaniKani meaning/reading mnemonics for a vocabulary item, backfilled from
-- the WaniKani API (scripts/backfill-wanikani-mnemonics.ts) and surfaced only
-- as optional scaffolding on review cards (ReviewPage's "Show mnemonic").
-- Additive, nullable — only the ~6.5k words in WaniKani's catalog get filled;
-- everything else stays blank. Text carries WaniKani's own inline markup
-- (<radical>/<kanji>/<vocabulary>/<reading>/<ja>).
alter table public.vocabulary_items
  add column meaning_mnemonic text,
  add column reading_mnemonic text;
