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
