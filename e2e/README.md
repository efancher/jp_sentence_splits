# Browser tests

The regular suite uses `playwright.config.ts`. Run `npm run test:e2e` on a host
with the browser libraries installed. The chapter-review checks run at phone
and desktop widths in Chromium and WebKit; the original import/analyze/backup
test remains in WebKit.

## This machine: use the Playwright container

The host has browser downloads but lacks their Linux shared libraries. Use the
cached `mcr.microsoft.com/playwright:v1.61.1-jammy` image, matching the installed
Playwright version. Earlier successful Docker runs are also recorded in
`docs/STATUS.md` (the vocabulary POS-labeling entry). Do not install host browser
libraries just to repeat these checks.

From the implementation checkout, build and start a local-only preview:

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

Leave that preview running. From a second shell in the same checkout:

```bash
docker run --rm --network host --user "$(id -u):$(id -g)" \
  -v "$PWD:/work" \
  -v "$(realpath node_modules):$(realpath node_modules):ro" \
  -w /work mcr.microsoft.com/playwright:v1.61.1-jammy \
  node node_modules/@playwright/test/cli.js test \
  e2e/review-document.spec.ts --project=chromium --project=webkit --workers=1
```

The second mount supports isolated worktrees whose `node_modules` is an
absolute symlink to the main checkout's installed dependencies. Tests use the
already-running preview through host networking and fresh browser contexts,
with synthetic local IndexedDB data. They do not need production credentials
or a live transcription/alignment service. Use a local-only build without
production sync configuration for these tests.

Screenshots are saved under `test-results/`; Playwright records failure context
there too. The chapter tests check chapter boundaries, answer masking, target
scrolling, horizontal overflow and a single persisted review after grading.
Keep the image version in step with Playwright when upgrading dependencies.

## Extras workflow in GitHub Actions

`.github/workflows/extras-tests.yml` runs on pull requests, pushes to `main`,
and manually from Actions → **Extras workflow tests**. It runs the assistant-run
Python API tests and `book-extras.spec.ts` in Chromium and WebKit. The existing
Deploy workflow's `npm run check` also picks up the extras unit/component tests.
These checks need no repository secrets: API calls are mocked, browser data is
synthetic, and the Python runner is faked. Browser failures upload `test-results/`
(including retry traces) for seven days. This workflow is separate from the Pages
deploy job; it does not itself gate deployment.

The browser step sets `GITHUB_ACTIONS=false` so Vite serves the local test build
at `/` instead of the Pages subpath. `CI=true` retains Playwright's CI behavior:
clean preview startup, no focused tests, and one retry with a trace.

## Native pitch preparation

Use the same container command above with `e2e/native-pitch-practice.spec.ts`.
It runs desktop Chromium and iPhone 13-emulated WebKit, with a fresh persistent
browser profile per case under the test output directory. In this container,
WebKit's default ephemeral context fails IndexedDB Blob insertion with
“Error preparing Blob/File data to be stored in object store”; a persistent
profile supports the real audio storage/playback path. A writable HOME alone
does not resolve that failure.

The fixture is a synthetic WAV with seeded pitch and MFA-style phone alignment.
Assertions cover sounded kana, playback highlighting, phone chart following,
chunk listen–repeat, scroll reset on selection, recording detail, page overflow,
and stopping audio on close (including the detached practice audio element).
`native-practice.png` captures the whole-sentence view in each project's output.
These checks do not validate pitch or alignment against the actual native
recording, and emulated WebKit is not a physical iPhone playback check.
