-- Phase 7.2 (see docs/STATUS.md): the exact conjugated/inflected text of a
-- vocabulary occurrence as it appeared in its sentence, so review UI can
-- highlight/mask that specific occurrence. Additive, nullable — existing
-- rows (Anki-imported links, pre-this-change confirms) are simply not
-- eligible as reading-retrieval targets until re-confirmed.
alter table public.sentence_vocabulary
  add column surface_form text;
