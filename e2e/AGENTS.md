# Browser tests

Apply root guidance. Run commands from the repository root and consult
[README.md](README.md) for the tested container setup.

- Use `playwright.config.ts` and its configured Chromium/WebKit projects.
  `npm run test:e2e -- --project=chromium --project=webkit --workers=1` runs the
  suite. A new spec must be added to Chromium's explicit `testMatch` list if
  it should run there; WebKit currently uses the directory-wide default.
- Build a local-only app without production sync configuration. Seed synthetic
  IndexedDB data in isolated browser contexts; these tests do not need a live
  mining service or production account. Let the seed transaction finish before
  navigating to a page that reads it.
- When reusing a preview, complete the build before starting tests and leave
  `dist/` unchanged until they finish. CI starts its own preview. Follow the
  README's environment/base-path settings when reproducing CI locally.
- For actual Blob storage/playback in WebKit, follow the persistent-context
  fixture in `native-pitch-practice.spec.ts`. Ephemeral contexts in the tested
  container can fail Blob insertion. Do not silently skip audio assertions in
  a test whose purpose is to verify audio.
- Match the intended learning mode. Legacy word-card fixtures explicitly turn
  sentence-led mode off; default walkthrough completion creates a sentence card
  and no review. Preserve those persistence assertions when updating the UI.
- Prefer accessible locators and observable readiness over fixed sleeps.
  Inspect failure context/traces before relaxing assertions. Use phone and
  desktop widths for responsive changes and check for horizontal overflow.
- Private real-chapter cases intentionally skip without their mounted input.
  State skipped cases and reruns in reports. Emulated WebKit and synthetic WAVs
  do not establish physical-device or acoustic accuracy.

Use a Playwright container image matching the installed package version when
host libraries are unavailable. Keep screenshots, profiles and traces under
the ignored `test-results/` directory.
