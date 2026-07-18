# Satori Glossbook

Offline-capable progressive web app for analyzing Japanese sentences imported from **Satori Reader** vocabulary CSV exports.

This repository is the home of **Satori Glossbook** (name configurable in [`src/appConfig.ts`](src/appConfig.ts)). It is an analysis workspace, not a spaced-repetition system. Study data stays in your browser unless you explicitly export a backup.

Python reference behavior from the earlier Anki tooling lives under [`reference/`](reference/) for algorithm ports and regression expectations.

## Local development

```bash
npm install
npm run dev
```

Useful commands:

```bash
npm run check          # typecheck + unit tests
npm test               # unit / component tests
npm run build          # production build (local base `/`)
npm run build:pages    # production build with GitHub Pages base path
npm run preview        # serve the production build
npm run test:e2e       # Playwright happy path (WebKit)
```

## Tests

- **Unit tests** cover CSV import/dedupe, chunking regressions, furigana parsing, Dexie data operations, and backup round-trips.
- **Component tests** cover import → book → analysis autosave, explicit reorder controls, and Practice reveal stages.
- **Playwright** covers a concise WebKit happy path including reload persistence and backup export.

Fixtures live in [`fixtures/`](fixtures/). Do **not** commit personal full Satori exports (for example `exported 2.csv`); those patterns are gitignored.

## Production build

```bash
npm run build
npm run preview
```

For GitHub Pages deployment builds:

```bash
npm run build:pages
```

The deploy base path is centralized in `DEPLOY_BASE` inside [`src/appConfig.ts`](src/appConfig.ts) and consumed by [`vite.config.ts`](vite.config.ts).

## GitHub Pages deployment

The workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):

1. Installs from the lockfile (`npm ci`)
2. Runs type checking and unit tests
3. Builds with the Pages base path
4. Publishes `dist/` to GitHub Pages

### Repository settings to enable

1. **Settings → Pages**
2. **Build and deployment → Source**: GitHub Actions
3. After the first successful `main` deploy, open the Pages URL (typically `https://<user>.github.io/jp_sentence_splits/`)

Hash routing is used so nested routes do not 404 on refresh under project Pages.

## Installing on iPhone / iPad

1. Open the deployed site in **Safari**
2. Tap **Share → Add to Home Screen**
3. Launch from the Home Screen (standalone display)

### Importing a Satori export from the Files app

1. Export vocabulary from Satori Reader to Files
2. Open Glossbook → **Import**
3. Choose the CSV with the file picker
4. Review the preview, name the batch, and send sentences to Inbox or a book

### Backup and restore

Use **Settings → Backup & restore** to export/import versioned JSON. Prefer exporting before replacing local data. Browser-local data does **not** automatically synchronize between an iPhone and an iPad.

### Offline behavior

After the first successful load, the application shell and already-imported study data remain usable offline. Imported CSV files are not cached as app assets.

## Current limitations

- No cloud sync / accounts
- No automatic reconstruction of Satori article order
- Heuristic chunking/roles are suggestions only
- No AI translation or Anki sync in the MVP
- Fonts from Google Fonts need a network on first load; system JP fonts are the offline fallback

## Documentation

- [Design](docs/satori-glossbook-design.md)
- [Backup data format](docs/satori-glossbook-data-format.md)
