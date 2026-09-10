-- Forced-alignment result for a reference recording, computed once and
-- stored so review-time word-audio isolation (SegmentLoopPlayer,
-- isolatedWordRange — pitch_accent / word_listening cards, the karaoke
-- shadow text) doesn't depend on the tailnet-only MFA service being
-- reachable from the client. Populated at mining-commit time and by
-- scripts/backfill-reference-alignment.ts (run on the box that hosts the
-- aligner); opportunistically upserted by any client that computes a fresh
-- alignment while on-tailnet.
--
-- Deliberately NOT wired into the sync-event engine — same precedent as the
-- reference-audio blobs themselves (fetched via direct Supabase queries in
-- src/sync/audioSync.ts, not sync_events). It's derived, recomputable,
-- owner-scoped cache data; the client reads it directly in
-- loadOrComputeAlignment and mirrors it into the local Dexie
-- `referenceAlignments` table. `alignment_version` mirrors
-- analysisApi.ts's ALIGNMENT_VERSION; a client ignores a row whose version
-- it doesn't recognise (same contract as getReferenceAlignment).
create table public.reference_alignment (
  id text primary key references public.reference_audio (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  alignment jsonb not null,
  alignment_version integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reference_alignment_owner_id_idx on public.reference_alignment (owner_id);

create trigger reference_alignment_set_updated_at before update on public.reference_alignment
  for each row execute function sync_private.set_updated_at();

alter table public.reference_alignment enable row level security;

create policy reference_alignment_select on public.reference_alignment
  for select to authenticated
  using (owner_id = auth.uid());
create policy reference_alignment_insert on public.reference_alignment
  for insert to authenticated
  with check (owner_id = auth.uid());
create policy reference_alignment_update on public.reference_alignment
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create policy reference_alignment_delete on public.reference_alignment
  for delete to authenticated
  using (owner_id = auth.uid());
