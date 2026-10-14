-- Private bucket holding one Opus copy of each mined source video, keyed
-- {video_id}.opus. Written/restored by the youtube-mining box with the
-- service-role key (bypasses RLS); signed-in clients may read it so a clip
-- boundary can be adjusted without a connection to the box.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'source-audio',
  'source-audio',
  false,
  104857600, -- 100 MiB; a long episode at 32 kbps mono is a few MB
  array['audio/ogg', 'audio/opus']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy source_audio_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'source-audio');
