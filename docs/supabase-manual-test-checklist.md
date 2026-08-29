# Manual test checklist — Supabase sync

## Local-only (no env)

- [ ] App loads without `VITE_SUPABASE_*`
- [ ] Settings shows “Supabase is not configured”
- [ ] Create book / analyze / backup still work

## Auth

- [ ] Create account (email confirmation if enabled)
- [ ] Sign in / sign out
- [ ] Forgot password email + update password after redirect
- [ ] Session persists across reload
- [ ] Sync badge shows Signed out / Synced appropriately

## Migration

- [ ] Device with local data + first sign-in shows migration modal
- [ ] Upload local → appears in cloud / second browser
- [ ] Keep local only → no unexpected cloud overwrite
- [ ] Replace with cloud → backup downloads first; local replaced
- [ ] Audio blobs not uploaded during migration

## Sync

- [ ] Offline edit queues; reconnect pushes
- [ ] Sync now button works
- [ ] Soft-delete on one device removes on the other after pull
- [ ] Different records on two devices merge cleanly
- [ ] Same record conflict shows Keep local / Keep remote / Duplicate
- [ ] Bulk Keep all local / Keep all remote resolves every open conflict after confirm

## Sharing

- [ ] Owner invites viewer/editor
- [ ] Viewer cannot edit
- [ ] Editor can edit shared book content
- [ ] Owner can change role / remove member
- [ ] Non-owner cannot invite

## Audio

- [ ] Sync reference audio off → no Storage upload
- [ ] Sync on → metadata + file upload under `{user}/{book}/{id}.*`
- [ ] Download on demand; Wi-Fi-only respected when `navigator.connection` exists
- [ ] Clear audio cache removes local blobs
- [ ] Sync on, second device → clip imported on device A appears on device B (metadata after a sync, audio on play or after `hydrateMissingReferenceAudio`)
- [ ] "Download all reference audio now" re-populates after Clear audio cache

## Backup

- [ ] Export all / export one book
- [ ] Import preview + merge + replace
- [ ] Copy diagnostics contains no tokens

## GitHub Pages

- [ ] Production build with secrets embeds config
- [ ] Auth redirect URLs include `/jp_sentence_splits/` hash routes
- [ ] Nested hash routes do not 404
