# Application code

Apply the root guidance. Read the additional files in `db/` or `sync/` when
working there. Paths below are relative to `src/` unless stated otherwise.

- Pages and components read study data from Dexie, usually with `useLiveQuery`.
  Put persisted study mutations in the repository/data layer; do not add a
  parallel Supabase write path in a screen. Keep reusable transformations and
  scheduling decisions in `lib/`, with fetched inputs rather than hidden UI
  state or database access where practical.
- The app uses `HashRouter` for static hosting. Preserve its routes and the
  distinction between local `/` builds and the Pages deployment base path.
- Default sentence-led fixtures must work without confirmed vocabulary or word
  cards. A completed walkthrough introduces a sentence card; it does not record
  an FSRS review. Games log local rounds and do not grade FSRS cards.
- Preserve the audio ladder's introduction/relearning gates and explicit
  self-rating. For changes here, use the root tests
  `tests/audioReviewLadder.test.tsx` and `tests/sentenceLedRepository.test.ts` as
  starting points rather than relying only on isolated helper tests.
- AI suggestions and draft clause references are not independently verified
  answers. Keep source matching/invalidation and editable or ungraded behavior;
  do not silently promote a draft to an authoritative assessment.
- Native-only practice must retain its missing-native-audio behavior. Do not
  substitute TTS for a missing native recording. Preserve tap-initiated playback,
  quiet-mode choices and cancellation when a view closes or selection changes.
  Reuse the playback coordination code rather than introducing unmanaged audio.
- For substantial UI changes, verify phone and desktop layouts and persisted
  outcomes in a browser. Synthetic pitch/alignment fixtures verify interactions,
  not acoustic correctness or physical-iPhone behavior.

Component/repository fixtures and cleanup conventions are described in
[tests/AGENTS.md](../tests/AGENTS.md); browser setup is in
[e2e/AGENTS.md](../e2e/AGENTS.md).
