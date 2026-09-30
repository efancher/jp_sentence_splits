-- Soft-deleting a sentence must take its live book memberships and audio
-- clips with it, in the database, regardless of which client did it.
--
-- Until now the cascade lived only in the client (cascadeRetireSentenceLocal),
-- which queues one delete op per child row. Any child op that never landed
-- (delete op conflicted, device had not pulled the row, reference-audio sync
-- off on that device) left a live book_sentences row or reference_audio clip
-- pointing at a deleted sentence. The Reader skips such a row, leaving a hole,
-- and scripts that trust live clips (repair-episode-sentence-order backfill)
-- re-created memberships for deleted sentences (found 2026-09-30).
--
-- The trigger's UPDATEs fire the normal bump_version / sync_event triggers, so
-- other clients learn of the child deletes through the usual pull. It runs as
-- the caller (RLS still applies) and only touches rows that are still live,
-- so a client that already deleted them is unaffected.
--
-- Deliberately not a backfill: existing dangling rows are repaired by
-- scripts/repair-dangling-sentence-rows.ts after review.
create or replace function sync_private.cascade_sentence_soft_delete()
returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.book_sentences
       set deleted_at = new.deleted_at
     where sentence_id = new.id
       and owner_id = new.owner_id
       and deleted_at is null;
    update public.reference_audio
       set deleted_at = new.deleted_at
     where sentence_id = new.id
       and owner_id = new.owner_id
       and deleted_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists sentences_cascade_soft_delete on public.sentences;
create trigger sentences_cascade_soft_delete
  after update of deleted_at on public.sentences
  for each row execute function sync_private.cascade_sentence_soft_delete();
