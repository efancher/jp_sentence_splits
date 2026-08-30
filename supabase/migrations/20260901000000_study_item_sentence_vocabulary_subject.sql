-- Contextual conjugation card (see docs/STATUS.md): widens
-- study_items.subject_type to accept 'sentenceVocabulary' — subjectId is a
-- sentence_vocabulary.id, i.e. one specific occurrence of a word in one
-- sentence. Same precedent as the 'vocabularyConfusion' (20260816010000) and
-- 'grammarPattern' (20260819000000) widenings. No existing row is affected.
alter table public.study_items
  drop constraint study_items_subject_type_check;

alter table public.study_items
  add constraint study_items_subject_type_check
  check (subject_type in ('sentence', 'vocabularyItem', 'chunk', 'vocabularyConfusion', 'grammarPattern', 'sentenceVocabulary'));
