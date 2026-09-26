-- Learner-named podcast feed URLs ("S-Town" -> the actual RSS URL), saved
-- from QuickMinePage/YouTubeMinePage's "Or import a podcast episode" input
-- so a feed URL (often just a generic host + opaque id) doesn't have to be
-- re-found or re-pasted. Synced (unlike AppSettings.recentPodcastFeedUrls,
-- a per-device MRU list) so a saved feed follows the learner across
-- devices. Mirrors sync_issue_reports: small, no cross-table ownership
-- check needed. See docs/STATUS.md.
create table public.named_podcast_feeds (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index named_podcast_feeds_owner_id_idx on public.named_podcast_feeds (owner_id);

create trigger named_podcast_feeds_set_updated_at before update on public.named_podcast_feeds
  for each row execute function sync_private.set_updated_at();
create trigger named_podcast_feeds_bump_version before update on public.named_podcast_feeds
  for each row execute function sync_private.bump_version();
create trigger named_podcast_feeds_sync_event after insert or update on public.named_podcast_feeds
  for each row execute function sync_private.append_sync_event();

alter table public.named_podcast_feeds enable row level security;

create policy named_podcast_feeds_select on public.named_podcast_feeds
  for select to authenticated
  using (owner_id = auth.uid());
create policy named_podcast_feeds_insert on public.named_podcast_feeds
  for insert to authenticated
  with check (owner_id = auth.uid());
create policy named_podcast_feeds_update on public.named_podcast_feeds
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create policy named_podcast_feeds_delete on public.named_podcast_feeds
  for delete to authenticated
  using (owner_id = auth.uid());
