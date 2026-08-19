# Architecture

This repo (`satori-glossbook`, product name "Satori Glossbook") is the
canonical target for a unified personal Japanese study app — see
[`UNIFIED_APP_ARCHITECTURE.md`](./UNIFIED_APP_ARCHITECTURE.md) for the full
cross-repo analysis and decision record (canonical-repo choice, migration
strategy, FSRS/Anki/shadowing integration strategy, risks). This document is
the shorter, living summary — update it when the architecture actually
changes; the analysis doc stays as a historical record and generally
shouldn't need further edits. For a present-tense, feature-by-feature
reference of the whole product (meant to be pasted into another AI's
context, e.g. to brainstorm new features), see
[`AI_OVERVIEW.md`](./AI_OVERVIEW.md).

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
after insert — sync-conflict-free by construction). Added later, same
pattern: `VocabularyConfusion` (Phase 7.6 — an undirected pair of
vocabulary items the learner tends to confuse, drives contrastive-pair
review cards) and `CardIssueReport` (a learner-flagged "this card looks
wrong" report on any study item, triaged out-of-band via
`scripts/list-card-issues.ts`).

## Sync engine

`src/sync/engine.ts` — per-record optimistic concurrency (`version` +
compare-and-swap), soft deletes (`deleted_at`), an append-only
`public.sync_events` table as the pull cursor, manual conflict resolution UI
(`ConflictPanel.tsx`: keep-local / keep-remote / duplicate). Same Supabase
project is already shared with the (separate, being absorbed) `shadowing`
repo, isolated via table prefixes — see `supabase/docs/supabase-setup.md`.

All unified-model tables are now wired into the TypeScript sync engine
(`src/sync/mappers.ts`, `SyncEntity`) — `study_items`/`reviews` since Phase
4, `vocabulary_items`/`kanji`/`sentence_vocabulary`/`vocabulary_kanji`
since Phase 5, `vocabulary_confusions` since Phase 7.6, `card_issue_reports`
since the card-issue-reports feature. The one exception is `sources`: still
no writer anywhere, so nothing to sync yet.

## Scheduling

FSRS via [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) —
pure TypeScript, no runtime deps, actively maintained by the same org that
maintains Anki's own reference FSRS implementation. `src/lib/scheduling.ts`
is a thin wrapper with no knowledge of sentences/chunks — it only ever sees
`StudyItem.fsrsState` (shaped to match `ts-fsrs`'s `Card`) and a rating.
Live since Phase 4 (`comprehension`/`reading_in_context`), extended through
Phase 7 to `vocabularyItem` and `vocabularyConfusion` subjects and several
more `activityType`s (`reading_production`, `sentence_transformation`,
listening, cloze) — see `docs/STATUS.md` for the full list. Also includes
auto error-classification (`classifyReviewError`) and graduation
(`isGraduated`, retiring a study item from the due rotation past a
configurable FSRS-interval threshold).

## External interop

- **`shadowing` repo**: CLI (`shadowmine`, Python) stays separate — mines
  YouTube/source material into `.shadowing.zip`, importable via
  `src/lib/shadowingImport.ts`. The standalone web app's practice UI
  (record/compare/pitch-analysis, plus new pronunciation-feedback work not
  in the original) has been fully ported in (Phases 3, 8, 9) and the
  standalone app is retired — see the memory note "Shadowing repo
  superseded". `scripts/tokenize_sentences.py` still shells out to the
  `shadowing` checkout's fugashi/UniDic tokenizer for the vocabulary-
  suggestion backfill script, since a browser-side JS tokenizer was
  deliberately rejected (bundle size, second engine).
- **`anki` repo**: archived (Phase 6, read-only on GitHub) — its one useful
  content, existing Satori/Shadowing sentence notes, was imported once via
  `anki_headless/` and verified (Phase 2). WaniKani-catalog and JMDict
  vocabulary/kanji content is ingested natively (`scripts/import-wanikani-
  kanji.ts`, `scripts/lib/jmdict.ts`), independent of Anki. No ongoing Anki
  sync, no export-back-to-Anki path.
- **`shadowing-analysis-api`** (`~/projects/shadowing-analysis-api`, a
  separate repo, Phase 9): a self-hosted forced-alignment service (Montreal
  Forced Aligner-backed), running as a `systemd --user` service on the
  user's Hetzner box, reachable only over their Tailscale tailnet (`tailscale
  serve`). `src/lib/analysisApi.ts` calls it and Dexie-caches the alignment
  result; the shadowing/pronunciation-feedback features degrade gracefully
  (skip alignment-dependent feedback) when it's unreachable — there is no
  fallback alignment path. Also runs `faster-whisper` (`base` model) for a
  secondary, non-authoritative ASR signal.
- **WaniKani API**: source of the kanji catalog (`scripts/import-wanikani-
  kanji.ts`), one-time/occasional bulk import, not a live per-user
  integration.
- **JMDict** (`jmdict-simplified`, pinned release, downloaded/cached by
  `scripts/lib/jmdict.ts`): local dictionary lookups and several backfill
  scripts (vocabulary meanings, suggestion glosses) — no network dependency
  at runtime, data is fetched once by whoever runs the script.
