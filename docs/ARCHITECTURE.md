# Architecture

This repo (`satori-glossbook`, product name "Satori Glossbook") is the
canonical target for a unified personal Japanese study app — see
[`UNIFIED_APP_ARCHITECTURE.md`](./UNIFIED_APP_ARCHITECTURE.md) for the full
cross-repo analysis and decision record (canonical-repo choice, migration
strategy, FSRS/Anki/shadowing integration strategy, risks). This document is
the shorter, living summary — update it when the architecture actually
changes; the analysis doc stays as a historical record and generally
shouldn't need further edits.

## Stack

React 19 + TypeScript 6 + Vite 8, `react-router-dom` v7 (`HashRouter`, for
GitHub Pages static hosting). Dexie 4 (IndexedDB) is the read/write source of
truth for the UI, read reactively via `dexie-react-hooks`' `useLiveQuery`.
Supabase (`@supabase/supabase-js`) provides optional cloud sync — the app is
fully usable offline/local-only. Zod v4 validates backups and imports.
`vite-plugin-pwa` makes it an installable PWA (iOS home-screen supported).

No state-management library, no UI component library, no MT/NLP dependency.
Keep it that way unless a real need forces the issue.

## Data flow

```
UI (pages/, components/)
  → src/db/repository.ts (all CRUD/business logic funnels through here)
    → Dexie (src/db/database.ts) — source of truth, works offline
      ↔ src/sync/ (optional, async, background) ↔ Supabase Postgres
```

## Data model

Core (existing, stable): `Book` → `BookChapter` (embedded) → `BookSentence`
(join) → `Sentence` (user-global, reusable across books) → `SentenceAnalysis`
(one per sentence, `chunks: AnalysisChunk[]` — the Cure-Dolly structural
analysis). See `src/domain/types.ts`.

Unified study model (additive, introduced Phase 1, see
`UNIFIED_APP_ARCHITECTURE.md` §8): `Source`, `VocabularyItem`, `Kanji`,
`VocabularyKanji` (join — which kanji, at which position, in a word),
`SentenceVocabulary` (join — sentence/chunk → canonical vocabulary item),
`StudyItem` (FSRS scheduling state, `activityType` is a free-form string so
new study activities are additive), `Review` (append-only, never updated
after insert — sync-conflict-free by construction).

## Sync engine

`src/sync/engine.ts` — per-record optimistic concurrency (`version` +
compare-and-swap), soft deletes (`deleted_at`), an append-only
`public.sync_events` table as the pull cursor, manual conflict resolution UI
(`ConflictPanel.tsx`: keep-local / keep-remote / duplicate). Same Supabase
project is already shared with the (separate, being absorbed) `shadowing`
repo, isolated via table prefixes — see `supabase/docs/supabase-setup.md`.

The new unified-model tables (Postgres side: `supabase/migrations/20260813000000_unified_study_model.sql`)
have triggers/RLS wired following the exact existing pattern, but are
**not yet wired into the TypeScript sync engine** (`src/sync/mappers.ts`,
`SyncEntity`) — deferred until something actually writes to them, to avoid
premature/untestable integration code. Wire this in when the first UI that
writes `vocabulary_items`/`kanji`/`study_items`/`reviews` is built.

## Scheduling (planned, not yet implemented)

FSRS via [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) —
pure TypeScript, no runtime deps, actively maintained by the same org that
maintains Anki's own reference FSRS implementation. Integration shape: a
thin `src/lib/scheduling.ts` wrapper with no knowledge of sentences/chunks —
it only ever sees `StudyItem.fsrsState` (shaped to match `ts-fsrs`'s `Card`)
and a rating.

## External interop

- **`shadowing` repo**: CLI (`shadowmine`, Python) stays separate — mines
  YouTube/source material into `.shadowing.zip`, already importable via
  `src/lib/shadowingImport.ts`. The web app's practice UI (record/compare/
  pitch-analysis) is being ported in (not yet started); the standalone app
  will then be retired.
- **`anki` repo**: one-time historical import only (via `anki_headless/`,
  already built and verified there) of existing Satori/Shadowing sentence
  notes. WaniKani-catalog and JMDict vocabulary/kanji content is ingested
  natively (WK API + JMDict importer, not yet built), independent of Anki.
  No ongoing Anki sync, no export-back-to-Anki path is planned.
