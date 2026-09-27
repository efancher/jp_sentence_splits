-- Hiragana reading for GrammarPattern.canonicalName, needed only when the
-- canonical name itself carries kanji (descriptive/structural pattern names
-- like "～という/～ての列挙的記述" rather than a fixed kana particle string).
-- Additive, nullable: unset means canonicalName is already kana and answer
-- checking falls back to exact/hiragana-normalized match against it directly.
alter table public.grammar_patterns
  add column reading text;
