-- Clips re-cut on the device (offline clip adjusting) are 16-bit WAV.
update storage.buckets
set allowed_mime_types = array['audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/webm', 'audio/wav']
where id = 'reference-audio';
