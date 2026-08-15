-- Phase 7.6 (see docs/STATUS.md): reserves a new study_items.subject_type
-- value, 'vocabularyConfusion', ahead of its first real consumer (Phase
-- 7.7's contrastive review) — same precedent as 'vocabularyItem' being
-- reserved in the Phase 1 migration before Phase 7.2 became its first
-- consumer. No existing row is affected; this only widens what future rows
-- may contain.
alter table public.study_items
  drop constraint study_items_subject_type_check;

alter table public.study_items
  add constraint study_items_subject_type_check
  check (subject_type in ('sentence', 'vocabularyItem', 'chunk', 'vocabularyConfusion'));
