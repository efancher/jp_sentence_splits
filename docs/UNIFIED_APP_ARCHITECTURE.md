# Unified Japanese Study App — Architecture & Consolidation Analysis

Status: **Phase 0 (analysis) complete — frozen historical snapshot.** This document is the deliverable requested before any implementation began. It is based on direct source inspection of all three repositories (not README claims alone) — see citations throughout. It records what was *analyzed and proposed* at the time, not current state; for that see `docs/ARCHITECTURE.md` / `docs/STATUS.md`.

> **Divergence note (2026-09-02):** the "native, ongoing WaniKani API ingestion path" proposed below was implemented only as a **one-time** import of the kanji catalog (readings/meanings) during Phase 2. A later feature layering WaniKani/Tofugu mnemonics onto review cards was removed on 2026-09-02 in favour of learning-in-context; there is no live WaniKani integration and no WaniKani ingestion tooling in the repo anymore. JMDict likewise became a local lookup tool, not an ongoing importer. Read every "WaniKani API client" / "ongoing ingestion" statement below as superseded.

Repos inspected:
- `efancher/jp_sentence_splits` (package name: **`satori-glossbook`**, internal product name "Satori Glossbook") — cloned to `~/projects/jp_sentence_splits`
- `efancher/shadowing` — cloned to `~/projects/shadowing`
- `efancher/anki` — already present at `~/projects/anki`

**Cross-repo fact established during inspection, not previously stated anywhere centrally**: `jp_sentence_splits` *is* "Glossbook"/"Satori Glossbook". The `shadowing` repo's Supabase migration (`supabase/migrations/20260727000000_shadowing_sync_schema.sql`) and its setup doc explicitly design around **coexisting in the same Supabase project as** an already-established sibling app it calls "Glossbook" — table prefixes (`shadowing_*`), a separate schema (`shadowing_private`), and a separate storage bucket (`shadowing-audio`) all exist specifically to avoid colliding with Glossbook's `books`/`sentences`/`sync_events`/`sync_private`/`reference-audio` objects. Those exact table/schema/bucket names are the ones defined in `jp_sentence_splits/supabase/migrations/20260722000000_sync_schema.sql`. So today there are already **two apps sharing one Supabase project**, with a proven isolation pattern between them (`shadowing/scripts/verify-shadowing-migration-isolation.sh` greps every new migration for accidental collisions). This pattern — additive migrations, prefixed tables, a verification script — is directly reusable for adding the unified schema alongside both existing schemas.

---

## 1. Current-state architecture of each repository

### 1.1 `jp_sentence_splits` / Satori Glossbook

- **Stack**: React 19 + TypeScript 6 + Vite 8, `react-router-dom` v7 (`HashRouter`, for GitHub Pages static hosting), Dexie 4 (IndexedDB) as the read/write source of truth via `dexie-react-hooks`' `useLiveQuery`, Supabase (`@supabase/supabase-js`) for optional cloud sync, Zod v4 for schema validation, `@dnd-kit` for drag-and-drop reordering, `papaparse` for CSV, `fflate` for zip read/write. No state-management library, no UI component library (custom CSS).
- **Purpose today**: a Japanese **sentence analysis workspace** — explicitly not an SRS (`README.md`: "It is an analysis workspace, not a spaced-repetition system"). Imports sentences from Satori Reader CSV exports and `.shadowing.zip` packages, organizes them into books/chapters, and supports deep Cure-Dolly-style structural (chunk/role) analysis plus lightweight "Practice" (reveal) and "Build" (reconstruct-from-English) study modes.
- **Data access**: a single large functional repository module, `src/db/repository.ts` (1337 lines), through which all CRUD/business logic flows — called directly from pages/hooks, no separate service layer.
- **Testing**: Vitest (unit + component, jsdom + `fake-indexeddb`) with 22 test files covering chunking/roles/sticky-English/paste-order/sync/migration/import, plus Playwright e2e (WebKit). This is the most heavily-tested of the three repos, especially around its core linguistic logic and its sync engine (14 dedicated sync tests).
- **PWA**: fully configured and working (`vite-plugin-pwa`, manifest, iOS home-screen meta tags, Workbox precache) — not aspirational.

### 1.2 `shadowing`

- **Stack**: a monorepo — `cli/` is Python 3.11+ (Typer CLI, pydantic, yt-dlp, fugashi/UniDic, ffmpeg subprocess), `web/` is React 19 + TypeScript + Vite 7, Dexie 4 (separate IndexedDB database, name `"shadowing"`), Supabase, `wavesurfer.js` for waveform display, a self-implemented YIN pitch detector.
- **Purpose today**: two genuinely separate tools sharing a package format. The **CLI** (`shadowmine`) takes a YouTube/source URL through fetch → subtitle download/parse → interactive or bulk sentence mining → ffmpeg clip extraction → validated `.shadowing.zip` export. The **web app** is a fully-implemented shadowing *practice* tool: reference-clip playback (speed-adjustable), record-with-simultaneous-reference-playback, alternate A/B and dual-ear (binaural) comparison, manual quality rating, a client-side pitch/waveform analysis panel, an editable per-mora timing guide, and a standalone "lyric timer" for songs with no captions.
- **Data**: fully local-first (Dexie); user recordings are Blobs stored in IndexedDB, local-only by default, leaving the device only via explicit ZIP export or opt-in Supabase Storage sync.
- **Testing**: solid CLI test coverage (7 files) plus a shared JSON-Schema test suite for the package format (9 tests covering v1/v2 validity, zip-path-traversal, bad timestamps). The web app has exactly **one** test file (`services.test.ts`, 333 lines) and **zero tests for its own Supabase sync engine** (`sync/engine.ts`, `mappers.ts`, `queue.ts`, `resolveConflict.ts` are all untested) — this is the least-tested piece of infrastructure across all three repos, worth flagging given it's precisely the kind of code a consolidation effort will need to trust or replace.

### 1.3 `anki`

- **Stack**: Python 3.12, `genanki` for offline `.apkg` deck generation, `requests`/AnkiConnect HTTP calls for live-collection edits, `edge-tts`/VOICEVOX for TTS, plus (from this same conversation, already built and tested) `anki_headless/` — a headless client using the official pinned `anki==25.9.5` PyPI package that syncs directly with AnkiWeb (no desktop dependency).
- **Purpose today**: a large (~16,000-line) WaniKani-derived Japanese-vocabulary/kanji/grammar Anki deck generator, plus five custom desktop Anki add-ons (unlock-gating, adaptive new-card limits, deck-options presets, health-check, deck-stats) and ~25 `AnkiConnect`-driving scripts for live collection maintenance/repair.
- **This is not a candidate to become the unified app itself** — see §6 — but it is the single richest source of curated content and encodes years of pedagogical decisions (leech scoring, verb-pair contrasts, kanji-confusable groups, Tae-Kim-lesson-gated conjugation unlocks, prerequisite-chain unlocking) that should be preserved as *data*, not re-derived.

---

## 2. Feature inventory (cross-repo)

| Feature | jp_sentence_splits | shadowing | anki |
|---|---|---|---|
| Sentence import (CSV/Satori) | ✅ full | — | ✅ (offline `.apkg` + live AnkiConnect) |
| Sentence import (`.shadowing.zip`) | ✅ full (consumer) | ✅ (producer, CLI) | ✅ (consumer, `shadowing_decks.py`) |
| Structural chunk/role analysis (Cure-Dolly) | ✅ (the core feature) | — | — (only in inert `reference/satori_gloss.py`) |
| Sticky/literal English glossing | ✅ local heuristic, no MT (chunk/sentence); vocabulary *meanings* have an optional Claude/JMDict pre-fill, always editable | — | — (Python reference version *did* call an MT API; not ported) |
| Furigana rendering | ✅ (from inline bracket notation, not generated) | — (VTT-based, no furigana) | ✅ (WK/Migaku-ruby-derived, sentence + word level) |
| Book/chapter/source organization | ✅ | ✅ (flat "sources," no chapters) | ✅ (decks, flat) |
| Vocabulary tracking | ✅ 3-tier (imported/suggested/curated), span-based | — | ✅ rich (WK subjects + JMDict), but flashcard-shaped |
| Kanji entity / readings model | ❌ none | ❌ none | ⚠️ implicit only, inside WK-subject note fields |
| Reading-in-context vs. isolated-kanji-reading distinction | ❌ | ❌ | ⚠️ partially — `Reading` (word) vs `SentenceKana` (sentence) exist, but no explicit kanji↔word graph |
| Device TTS | ✅ (`SpeechController`, Web Speech API) | — | ✅ (edge-tts/VOICEVOX, generation-time only) |
| Native/reference audio playback | ✅ (`NativeAudioController`) | ✅ (richer — speed control, A/B, dual-ear) | ✅ (baked into cards at generation time) |
| User recording + compare | ❌ | ✅ (the practice app's core feature) | ❌ |
| Pitch/waveform analysis | ❌ | ✅ (YIN pitch, live waveform) | ✅ (Kanjium data, static, not interactive) |
| Spaced repetition scheduling | ❌ (explicitly not an SRS) | ❌ | ✅ (Anki's own SM-2-derived/FSRS scheduler) |
| Review history | ❌ | ⚠️ (attempt history, not SRS review) | ✅ (Anki's revlog) |
| Supabase sync | ✅ mature, tested, conflict-resolved | ✅ present, **untested** | ❌ (not applicable; has its own AnkiWeb sync now) |
| PWA / offline | ✅ working | ⚠️ `vite-plugin-pwa` present as devDependency, not confirmed wired up with the same rigor | ❌ n/a (desktop/mobile native app) |
| Anki interoperability | ❌ | ❌ | ✅ (native) + `anki_headless/` (new, this session) |

---

## 3. Overlapping functionality

1. **`.shadowing.zip` consumption** exists in both `jp_sentence_splits` (`src/lib/shadowingImport.ts`) and `anki` (`shadowing_decks.py`). Both parse the same schema (`schemas/shadowing-package.schema.json` from the `shadowing` repo, versions 1–2). Glossbook's importer is TypeScript/browser-side; Anki's is Python/offline. Functionally redundant once Anki is no longer the target — Glossbook's importer is the one to keep.
2. **Supabase sync engine pattern** — Glossbook's (`src/sync/`) and shadowing's (`web/src/sync/`) independently reimplement the same design: per-record `version` optimistic-concurrency, soft-delete via `deleted_at`, an append-only `*_sync_events` table as a pull cursor, RLS via `owner_id = auth.uid()`. Glossbook's is tested and battle-tested (14 tests, handles conflict UI); shadowing's is not tested at all. This is the same problem solved twice, once well.
3. **Vocabulary/gloss lookup** — Glossbook's `targetVocabulary` (from Satori CSV) and Anki's JMDict-backed `jmdict_gloss.py`/`mining_vocab_index.py` both ultimately answer "what does this word mean" for a given expression+reading; Anki's is broader (full JMDict-derived index with POS) where Glossbook's is limited to whatever Satori happened to export.
4. **Conjugation-form modeling** — Glossbook has none; Anki has a mature, tested engine (`conjugate_vocab_form()`, validated against 86 fixture rows across 6 word classes). This is a real gap in Glossbook that Anki's engine (or its curated fixture data) can fill.
5. **Device TTS** exists independently in both Glossbook (`SpeechController`) and Anki's generation pipeline (edge-tts/VOICEVOX, baked into cards ahead of time). Different approaches (live browser TTS vs. pre-baked audio files) — not really duplicated so much as two different valid strategies for different constraints.
6. **Pitch-accent data**: Anki has a working Kanjium-dictionary pitch loader (`immersion_pitch.py`) producing per-mora pitch shapes; the `shadowing` web app computes pitch live from recorded audio (YIN). These are complementary (reference pitch shape vs. measured pitch of an attempt), not duplicated.

---

## 4. Functionality unique to each repository

**Unique to `jp_sentence_splits`**: the entire Cure-Dolly structural chunking/role/sticky-English engine (`src/lib/chunking.ts`, `stickyEnglish.ts`, `clauseBands.ts`, `puzzleShapes.ts`) — this is genuinely unique across all three repos and across, as far as this analysis can determine, typical Japanese-learning tooling generally. Also unique: the tested Supabase sync engine with manual conflict resolution UI, the "Build mode" sentence-reconstruction study activity, zero-が synthetic-subject chunk modeling, and paste-order re-sequencing against copied source text.

**Unique to `shadowing`**: the entire YouTube/subtitle mining pipeline (nothing else in any repo can produce a `.shadowing.zip` from a URL), and the entire recording/comparison/pitch-analysis practice UI (listen → record → compare → rate). Also unique: the lyric-timer tool for uncaptioned songs.

**Unique to `anki`**: WaniKani catalog integration (60 levels of radicals/kanji/vocabulary with official readings/meanings), the prerequisite-chain unlock model, leech/confusable/verb-pair detection, JLPT-banded grammar content (Hanabira-derived) with Tae Kim lesson mapping, the conjugation engine + fixtures, Kanjium pitch-dictionary integration, and — critically — **years of the user's own real spaced-repetition review history**, which lives only in the user's actual AnkiWeb account, not in this repo's code at all (confirmed reachable via `anki_headless/`, already built this session).

---

## 5. Reusable components/modules (highest-value extraction candidates)

From `jp_sentence_splits` (pure logic, no framework/DB coupling — directly portable):
- `src/lib/chunking.ts`, `clauseBands.ts`, `puzzleShapes.ts`, `stickyEnglish.ts` — the analysis engine itself.
- `src/lib/parseInlineReadings.ts` — bracket-furigana parser.
- `src/lib/speech.ts` (`SpeechController`), `src/lib/nativeAudio.ts` (`NativeAudioController`) — dependency-free, subscribe/snapshot pattern classes.
- `src/lib/vocabularySuggestions.ts` — span-based suggestion/merge logic, already generic beyond Satori.
- `src/domain/schemas.ts` (Zod) — the compatibility layer for reading this app's own backup format.

From `shadowing`:
- `schemas/shadowing-package.schema.json` — the package contract itself; language-agnostic, keep as the shared source of truth.
- `cli/src/shadowmine/subtitles.py`, `readings.py`, `morphology.py` — subtitle parsing/alignment and fugashi-based reading/morphology generation, independently importable.
- `web/src/analysis/pitch.ts` (YIN pitch detection) and `web/src/services/recording.ts` (`RecordingService`, `PlaybackCoordinator`) — generic Web Audio utilities with no app-specific coupling.
- `shadowmine` CLI as a whole, invoked as an external tool rather than reimplemented.

From `anki`:
- `wk_decks.py::conjugate_vocab_form()` + `conjugation_fixtures.json` — the conjugation engine and its verification data.
- `jmdict_gloss.py`, `jmdict_pos.py` — JMDict-backed gloss/POS indexing (pure data transforms, no Anki coupling).
- `immersion_pitch.py` — Kanjium pitch-dictionary loader.
- Kanji-contrast groups, verb-pair rules, and the Tae Kim section/lesson mapping — all curated *data*, worth exporting once as JSON rather than re-deriving.
- `anki_headless/` (this session's work) — the AnkiWeb sync bridge, directly reusable as the Anki-interop layer (see §11).

---

## 6. Proposed canonical repository: **`jp_sentence_splits` (Satori Glossbook)**

This **confirms** the user's stated hypothesis, based on evidence rather than assumption:

1. It already has the most mature, tested, offline-first, conflict-resolving Supabase sync engine of the three — the single hardest piece of infrastructure to get right, and it's already right here.
2. It has a genuinely working, tested PWA setup — a hard requirement (§3 of the request).
3. It owns the primary Supabase project that `shadowing` already treats as authoritative and defers to.
4. Most importantly: it contains the one piece of functionality that is **irreplaceable and central to the stated product goal** — the Cure-Dolly structural analysis engine. This is precisely the thing that makes the target app "not a generic Anki clone." Neither of the other two repos has anything like it.
5. Its data model (`Sentence`/`Book`/`BookSentence`/`SentenceAnalysis`/`AnalysisChunk`) is already close in shape to the sketch in the request (§4) and is cleanly normalized (sentences are reusable across books via a join table, not duplicated).
6. It is the leanest, most current-generation stack of the three (React 19, Vite 8, TS 6, zero framework cruft), with the best existing test discipline.

**What this repo is missing, that must be added**: a `Kanji` entity, a first-class `VocabularyItem` entity (currently vocabulary is span/string-based, not a normalized table with stable IDs), `StudyItem`/FSRS scheduling, `Review` history, and the shadowing practice UI (record/compare/rate). All four are additive — none require touching or breaking the existing sentence/analysis/book/sync functionality.

**What happens to the other two repos**: per the request's own menu of options (archived / CLI tool / import-migration tool / library / deprecated), the recommendation is:
- `shadowing/cli` — **stays a separate Python CLI**, unchanged, invoked as an external tool when mining new material. This matches the request's own suggestion (§8, §25: "the Python shadowmine CLI can remain Python").
- `shadowing/web` — **absorbed**, not kept running long-term. Its practice-UI logic (recording, comparison, pitch analysis, playback coordination) gets ported into Glossbook (Phase 3, §12 below); the standalone web app can then be archived. Its Supabase tables (`shadowing_*`) can eventually be dropped once nothing depends on them, but not until the port is verified — no rush, no data loss risk either way since it's additive/prefixed.
- `anki` — **becomes a fully archived, one-time migration source. Confirmed by the user: migrating away from Anki entirely is acceptable**, which simplifies this considerably versus treating it as a permanent parallel system. `anki_headless/` (already built) is used **once** to pull the user's existing Satori/Shadowing sentence data out of AnkiWeb into the unified model (§11) — not kept running as an ongoing sync bridge, and no export-back-to-Anki path is planned. The deck-generator Python code's curated *data* (conjugation fixtures, kanji-contrast groups, Tae Kim mapping) is worth a one-time extraction; the WK-catalog and JMDict *content pipelines* are better rebuilt as native, ongoing, web-triggerable ingestion in the unified app itself (§9) rather than continuing to depend on Anki's Python code as a middleman for data that doesn't actually originate in Anki.

---

## 7. Proposed target architecture

```
Browser / PWA (evolved jp_sentence_splits)
    React + TypeScript + Vite + Dexie (IndexedDB, source of truth for offline use)
        │
        ├── Analysis engine (existing, ported as-is)
        ├── Study engine (NEW: StudyItem generation + ts-fsrs scheduling)
        ├── Shadowing practice (ported from shadowing/web)
        └── sync/ (existing engine, extended to new tables)
        │
        └── Supabase (existing project — same one already shared with `shadowing`)
              ├── Postgres (existing `public.*` tables + new unified-model tables, additively migrated)
              ├── Auth (existing)
              └── Storage (existing `reference-audio` bucket + reused pattern for shadowing audio)

Separate, unchanged:
  shadowmine CLI (Python) ──produces──> .shadowing.zip ──imported by──> the app (existing importer)
  anki repo (Python, archived-generator role) ──produces content exports──> one-time import layer ──> the app
  anki_headless/ (Python, in anki repo) ──AnkiWeb sync──> Anki (interop/export destination, ongoing)
```

No new backend service is introduced. No microservices, no Kubernetes, no generic plugin system — matching §25's explicit constraint. The "backend" remains Supabase (already provisioned, already trusted) plus static hosting (already working via GitHub Pages).

---

## 8. Proposed unified data model

Extending Glossbook's existing schema (`src/domain/types.ts`, `supabase/migrations/20260722000000_sync_schema.sql`) rather than replacing it. Existing tables (`books`, `sentences`, `book_sentences`, `analyses`, `import_batches`, `inbox`, `reference_audio`) are **kept as-is** — every one of them maps cleanly onto the request's sketch already:

| Request's sketch | Existing Glossbook entity | Verdict |
|---|---|---|
| `Source` | `Book.sourceKey` / `Book.sourceUrl` (string field, not a table) | Promote to a real `sources` table (see below) — currently conflates "book" and "source of a book" |
| `Book`/`Collection` | `Book` + `BookChapter` (embedded) + `BookSentence` (join) | Keep as-is; already normalized correctly |
| `Sentence` | `Sentence` | Keep as-is; add `sourceId` FK once `sources` exists |
| `Chunk` | `AnalysisChunk` (inside `SentenceAnalysis.chunks: jsonb`) | Keep as-is for now (see risk in §14 about JSONB granularity) |
| `VocabularyItem` | **Does not exist as a table** — currently 3 different span/string-based concepts (`targetVocabulary`, `vocabularySuggestions`, `vocabularySelections`) | **New table required** — see below |
| `Kanji` | **Does not exist anywhere in any repo** | **New table required** — see below |
| `StudyItem` | Does not exist (app has no SRS) | **New table required** |
| `Review` | Does not exist | **New table required**, append-only |

### New tables (additive Dexie schema version + additive Postgres migration, following the exact pattern already used for every prior schema change in this repo)

**`sources`** — promotes the currently-stringly-typed `Book.sourceKey`/`sourceUrl` into a real entity: `id, title, type (satori | youtube | podcast | manual | other), creator, url, externalId (e.g. shadowmine's videoId), metadata (jsonb), createdAt`. `Book.sourceId?` becomes a nullable FK (a book need not have a single source — CSV imports can span many). `SentenceAudio`/shadowing-ported reference audio also FKs to `sources` via the sentence.

**`vocabulary_items`** — the normalized word entity the request cares most about getting right: `id, expression, reading, meaning, partOfSpeech, notes, createdAt, updatedAt`. Uniqueness on `(expression, reading)` (mirrors Anki's `lemma_key` pattern and JMDict's own homophone-safe indexing — deliberately *not* unique on `expression` alone, since 週間/習慣-style homophones must stay distinct). A join table `sentence_vocabulary (sentenceId, vocabularyItemId, chunkId?)` replaces the current span-based `vocabularySelections`/`vocabularySuggestions` with real foreign keys once a suggestion is confirmed — the existing suggestion/curation *workflow* (unreviewed → confirmed) is preserved, only its storage target changes from "an embedded span" to "a link to a canonical row."

**`kanji`** — genuinely new: `id, character (unique), meanings (jsonb array), onyomi (jsonb array), kunyomi (jsonb array), nanori (jsonb array), notes, createdAt`. A join table `vocabulary_kanji (vocabularyItemId, kanjiId, positionInWord)` records which kanji appear in which word and where — this is exactly the structure needed to eventually support "the primary learning target is the reading of the word in context, not an unordered list of kanji readings" (§12 of the request): a `StudyItem` for a vocabulary item's reading can be generated *from* `vocabulary_kanji` + `kanji.onyomi/kunyomi` without ever presenting an isolated-kanji-reading drill unless explicitly designed later. Seed data: Anki's WK-subject kanji readings (already typed `onyomi`/`kunyomi`/`nanori`) are the best available starting content source, imported once, not re-fetched from WaniKani on an ongoing basis.

**`study_items`** — one sentence (or vocabulary item) can generate several, per §11 of the request: `id, subjectType (sentence | vocabularyItem | chunk), subjectId, activityType (comprehension | listening | reading | vocab_in_context | cloze | build | shadowing | ...), fsrsState (jsonb: difficulty, stability, due, lapses, reps, state), createdAt`. `activityType` is a plain string, not an enum baked into the schema, so new activity types are additive (matches §11's "should be extensible rather than hard-coded").

**`reviews`** — append-only, event-sourced (per §17's explicit preference): `id, studyItemId, timestamp, rating (again|hard|good|easy — the FSRS 4-point scale), responseRaw?, expectedAnswer?, elapsedMs?, errorClassification? (nullable string/enum — incorrect_reading | incorrect_meaning | kanji_reading_interference | vocabulary_confusion | pronunciation_difficulty | listening_failure | grammar_misunderstanding | user_defined:<text> | null)`. Never updated after insert, only inserted — this both satisfies §17's sync-conflict-avoidance goal (append-only data can't conflict the way mutable rows can) and §13's error-classification goal (the column exists from day one; nothing populates it automatically in Phase 4, per the request's explicit "don't overbuild automatic classification... just make sure the data model doesn't prevent it").

All new tables follow the **exact existing convention**: `owner_id`, `version`, `deleted_at`, `client_id`, `last_modified_by`, RLS `owner_id = auth.uid()`, `updated_at`/version-bump triggers, `sync_events` append triggers (reviews' own append-only-ness makes its sync trigger trivial — inserts only, never updates). Dexie gets a corresponding new schema version with matching tables/indexes, exactly like the five prior version bumps in `src/db/database.ts`.

---

## 9. Migration strategy

**Principle**: additive, reversible, tested at each step — never a big-bang rewrite (per §2, §22, §23).

**Content-ingestion principle (clarified with the user during review of this document)**: the unified web app is the **single place new data enters the system**, full stop. No content type should require importing into more than one app/tool to become usable. Concretely this means:
- CSV (Satori) and `.shadowing.zip` import already satisfy this today (both land directly in Glossbook's own Dexie/Supabase) — no change needed.
- WaniKani-catalog and JMDict content, which today only reach Anki via `anki`'s Python pipeline, should become a **native, ongoing, web-triggerable ingestion path in the unified app** — a WaniKani API client and a JMDict importer that are part of the unified app's own tooling, not a dependency on the `anki` repo going forward. Anki's *algorithms* for this (how to parse JMDict POS tags, how to shape a WK subject) are worth porting/reusing (`jmdict_gloss.py`/`jmdict_pos.py`), but the *pipeline* itself should not require Anki as a middleman once ported — re-running it should never require touching the `anki` repo.
- The `anki` repo is used as an import source **exactly once**, narrowly, for the one kind of data that is genuinely only available there: the user's actual, already-mined Satori/Shadowing **sentences** sitting in their real Anki collection (years of prior mining that predates the unified app). Once imported, all *new* Satori/Shadowing content goes straight into the unified app via its existing importers — never through Anki again.

1. **Schema first** (Phase 1): add the five new Dexie tables + matching Postgres migration, with zero UI changes. Existing functionality is provably unaffected because nothing existing is touched — verified by running the full existing test suite (22 files) unchanged and green.
2. **Catalog content (kanji/vocabulary) ingestion, built as native unified-app tooling, not routed through Anki**: catalog-content importers callable directly from/for the unified app (e.g. a maintenance script or an admin-only import screen), populating `kanji`/`vocabulary_items` on a re-runnable basis. Idempotent, keyed on stable external IDs so re-running is a no-op on unchanged data (per §14's explicit requirement) — this satisfies "don't import the same data in multiple places" by design: there is exactly one ingestion path for this content, and it isn't Anki. *(As built: the kanji catalog was imported once and its importer since removed; JMDict is a local lookup tool, not an importer. See the divergence note at the top.)*
3. **One-time historical import from Anki**: `anki_headless` (already built, already verified against the real account) reads the user's existing `WK Satori Immersion`/`WK Shadowing Immersion`/`WK Shadowing Candidate` notes once and maps them into `Sentence`/`sentence_vocabulary` (§11). This is explicitly a one-shot backfill of otherwise-unrecoverable past work, not a pipeline kept running.
4. **User's existing Glossbook data migrates trivially** — it already lives in the target repo/schema; nothing to move.
5. **User's existing Anki review history is not migrated.** Since migrating away from Anki entirely is acceptable (confirmed by the user), there's no need to keep Anki queryable long-term either — after the one-time sentence import (point 3), Anki can be left alone/archived. The *new* app starts a fresh `reviews` log from the point the user begins using FSRS-scheduled `study_items`. This avoids the single riskiest kind of migration (reinterpreting Anki's SM-2-ish revlog as FSRS review history) entirely, at the cost of not importing historical review stats — an explicit, documented tradeoff rather than a silent gap.
6. **Backups before anything destructive**: Glossbook already has a full-fidelity JSON backup mechanism (`src/lib/backup.ts`) with checksums — extend it to cover the new tables before any migration script runs against real data, satisfying §22's backup-before-destructive-change requirement using infrastructure that already exists.

---

## 10. FSRS integration strategy

**Library: [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs)** (npm package `ts-fsrs`), from the `open-spaced-repetition` GitHub organization — the same organization that maintains Anki's own reference FSRS implementation. Confirmed via web search (not assumed from training data, since currency matters here): actively maintained, with a release as recent as June 2026 tracking the FSRS-6 algorithm; pure TypeScript, ships ESM/CJS/UMD, no runtime dependencies beyond itself — a clean fit for a browser/Dexie app with no server-side scheduling dependency. This directly satisfies §10's requirement to research and select a mature, maintained implementation rather than hand-rolling the algorithm.

**Integration shape**: a thin `src/lib/scheduling.ts` wrapping `ts-fsrs`'s `FSRS` class — pure functions `scheduleReview(studyItem, rating, now) → { updatedFsrsState, nextDue }`, called by a review-session component after each `Review` insert. The scheduler has **no knowledge** of sentences/chunks/vocabulary — it only ever sees `study_items.fsrsState` (an opaque-to-everything-else `jsonb` blob matching `ts-fsrs`'s own `Card` shape) and a rating. This satisfies §10's "cleanly separated from the UI and from the underlying linguistic content" requirement structurally, not just by convention.

---

## 11. Anki interoperability strategy

**Revised after clarification**: the user has confirmed migrating away from Anki entirely is acceptable. This removes the need for this to be an ongoing, two-way relationship — it narrows to a single, one-time, one-directional import.

**Anki → unified app, once**: use `anki_headless/` (built and verified working against the user's real AnkiWeb account earlier this session — see `anki/docs/anki_headless_sync.md`) to obtain a synced local `Collection` via the official Collection API, then run an **explicit translation script** (not a schema copy, not a kept-running tool) that reads specific note types via `col.find_notes`/`col.get_note` and maps them into the unified model:
- Highest-value first, and in practice the *only* thing this path is for: `WK Satori Immersion` / `WK Shadowing Immersion` / `WK Shadowing Candidate` notes map almost directly onto `Sentence` + `sentence_vocabulary` (they already carry `Sentence`, `Translation`, `Expression`, `Reading`, source info) — this is real, already-mined content that exists nowhere else, so it's worth a one-time careful import.
- WK-catalog/JMDict-derived content is explicitly **not** sourced through this path (see §9) — it's ingested natively and on an ongoing basis, directly from the WaniKani API and JMDict, decoupled from Anki entirely.
- Review history: **not** migrated (§9) — a one-time, deliberate gap, not an oversight.
- **Stable identifiers**: every imported row carries an `externalId` (e.g. `anki:{noteId}` or the note's own `DuplicateKey`/`GuidKey` field, which Anki's own generator already uses as a stable dedup key) so if the import script is re-run before the user is done double-checking results, it upserts rather than duplicates.
- Direct SQLite manipulation is **not used** — everything goes through the official Collection API via `anki_headless`, consistent with the existing `anki_headless` design's own safety rules (read-only integrity checks, no writes to the live collection without explicit confirmation).

**Unified app → Anki: not planned.** Given migrating away is acceptable, there's no ongoing product need for an export-back-to-Anki path, and building one would be pure speculative investment. If a concrete need surfaces later (e.g. wanting to keep studying some specific deck in Anki alongside the new app for a transition period), the building blocks already exist and are cheap to assemble on demand: Glossbook's existing `.mining.zip` export (`miningExport.ts`) plus the `anki` repo's existing `genanki`/AnkiConnect import scripts. Not scheduled as a phase.

After the one-time import (Phase 2/6, see §15), the `anki` repo and `anki_headless/` have no further ongoing role — they can be left alone/archived rather than maintained in parallel.

---

## 12. Shadowing integration strategy

Per §8/§25: the `shadowmine` CLI stays a separate Python tool, invoked externally, producing `.shadowing.zip` files that Glossbook already knows how to import (`src/lib/shadowingImport.ts` — no changes needed there).

The **web practice app's functionality** gets ported into Glossbook as a new page/route (`/sentences/:sentenceId/shadow` or similar), reusing its cleanest modules near-verbatim:
- `web/src/analysis/pitch.ts` (YIN pitch detection) and `web/src/analysis/japanese.ts` (mora splitting) — pure functions, copy with minimal adaptation.
- `web/src/services/recording.ts` (`RecordingService`, `PlaybackCoordinator`) — framework-agnostic, copy near-verbatim.
- The `SentencePage.tsx` UI patterns (record/compare/rate) get reimplemented against Glossbook's existing `Sentence`/`SentenceAudio` model rather than shadowing's separate `sources`/`sentences` Dexie tables — this is a genuine port, not a lift-and-shift, because Glossbook's `Sentence` is richer (already has book/chapter/analysis linkage that shadowing's flat `sources` model lacks).
- User recordings (`AudioAsset kind: "attempt"` in shadowing's model) become a new `attempts` Dexie table + matching `study_attempts`-style Postgres table, **local-only by default** (per §8/§18's explicit instruction), with the same opt-in Supabase Storage sync pattern shadowing already proved out (`shadowing_audio` bucket → reuse the pattern, new bucket name, e.g. `attempt-audio`, scoped under the existing `reference-audio`-style RLS).

This is Phase 3 in the plan below — deliberately *after* the schema groundwork (Phase 1) and content migration (Phase 2), since the practice UI is valuable but not blocking, and porting it well benefits from the new `vocabulary_items`/`kanji` tables already existing (so shadowing-sourced sentences can immediately participate in the same vocab-linking workflow as Satori-sourced ones).

---

## 13. Supabase / local-first sync strategy

No new architecture needed — **extend the existing one**. Glossbook's sync engine (`src/sync/engine.ts`) already implements exactly what §17 of the request asks for: per-record optimistic-concurrency (`version` + compare-and-swap), soft deletes, an append-only event log as a pull cursor, and manual conflict resolution (keep-local / keep-remote / duplicate) with a real UI (`ConflictPanel.tsx`) — all tested (14 tests). The new tables (§8) plug into this same engine by:
1. Adding them to `src/sync/mappers.ts` (camelCase ↔ snake_case row mapping — mechanical, following four existing examples).
2. Adding corresponding triggers to the new Postgres tables (copy-paste of the existing `sync_private.set_updated_at`/`bump_version`/`append_sync_event` trigger pattern).
3. For `reviews` specifically (append-only): the push path simplifies to insert-only (no CAS needed, since reviews are never updated) — actually a *simpler* case than every existing synced entity, not a harder one.

**Identifier strategy**: continue using client-generated UUIDs (`src/lib/ids.ts`, already the existing pattern) so offline-created records never collide across devices — no change needed.

**Local-first guarantee**: Dexie remains the only read/write path for the UI; Supabase sync is purely an async background reconciliation, exactly as today. The app continues to work fully offline after first load, including FSRS scheduling (pure client-side computation) and review recording (local insert, synced later).

---

## 14. Major risks

1. **`AnalysisChunk[]` is stored as one JSONB blob per sentence** (`analyses.chunks`), so two devices editing different chunks of the same sentence offline produces one conflicting record, not a mergeable per-chunk diff — already a known, documented limitation of the *existing* system (not introduced by this plan), but it becomes more visible once `sentence_vocabulary` links start pointing at specific chunks. Not blocking for Phase 1–3; worth revisiting if it causes real conflict-resolution pain once vocab-linking is in daily use.
2. **No repo has ever modeled an isolated `Kanji` entity with a readings graph** — this is new ground, not a port. The WK-subject data (via `anki_headless`) and JMDict (via `anki`'s existing parsers) are good *content* sources, but the relational design itself (§8's `kanji`/`vocabulary_kanji` tables) is being designed fresh in this document and should be validated against a real, moderately large import (e.g. the user's actual WK level 1–10 vocabulary) before assuming it scales cleanly to 60 levels.
3. **Anki review-history is deliberately not migrated** (§9) — this is a real, permanent gap (the new FSRS scheduler starts with zero prior review signal for words the user has actually studied for years in Anki). Confirmed an acceptable tradeoff by the user (migrating away from Anki entirely is fine) rather than something to work around; noted here so it stays a known, chosen decision rather than a surprise later.
4. **`shadowing/web`'s sync engine is untested** — if any part of it is reused rather than reimplemented against Glossbook's own (tested) engine, it needs its own test coverage added first. The recommendation in §12 is to *not* reuse shadowing's sync engine at all, only its recording/analysis/UI logic, specifically to sidestep this risk.
5. **The one-time Anki sentence import (§11) and the new native WK/JMDict ingestion (§9) both touch real curated data** — years of prior mining in the Anki case, and large reference datasets in the WK/JMDict case — get the idempotency/stable-ID behavior right and test both against a copy before running against the production Supabase project, per §22.
6. **Two Dexie databases in one browser** (`GlossbookDatabase` and, if `shadowing/web` isn't fully retired immediately, `"shadowing"`) — not a technical blocker (IndexedDB supports multiple named databases fine), but worth deliberately deciding when to sunset the standalone `shadowing/web` deployment rather than running both indefinitely.
7. **`tae_kim_exercise_decks.py` has a confirmed pre-existing bug** (`GrammarCardItem` instantiated with fields it doesn't declare, `TypeError` on that code path) discovered during this analysis — unrelated to the migration itself, but means Tae-Kim-exercise content specifically may not be reliably exportable from `anki` until that's fixed upstream; flag rather than silently trust that data source.

---

## 15. Phased implementation plan

Adopting the request's own phase list (§24), confirmed appropriate after inspection — no changes needed to the ordering itself, only to scope specifics now that real code has been read:

- **Phase 0 — Repository analysis.** ✅ Complete (this document).
- **Phase 1 — Unified data model.** Add `sources`, `vocabulary_items`, `kanji`, `vocabulary_kanji`, `sentence_vocabulary`, `study_items`, `reviews` to both Dexie (new schema version) and Postgres (new additive migration + sync triggers + RLS), with zero UI changes. Gate: full existing test suite (22 files) still green, plus new tests for the new tables' migrations (mirroring `tests/migration.test.ts`'s existing pattern).
- **Phase 2 — Existing data migration.** Two independent, idempotent, stable-ID-keyed pipelines, built as native unified-app tooling (§9): (a) WaniKani API client + JMDict importer → `kanji`/`vocabulary_items`, ongoing/re-runnable, no Anki dependency; (b) one-time `anki_headless`-mediated import of `WK Satori Immersion`/`WK Shadowing Immersion`/`WK Shadowing Candidate` notes → `Sentence`/`sentence_vocabulary`. Gate: dry-run + diff report before any write, per `anki_headless`'s existing validate-before-write convention; re-running either import is a verified no-op.
- **Phase 3 — Unified shadowing.** Port `shadowing/web`'s recording/comparison/pitch-analysis modules into Glossbook as a new practice route; new `attempts` table (local-first, opt-in sync). Gate: the ported pitch/recording modules get their own test coverage (closing shadowing/web's existing test gap, not carrying it forward).
- **Phase 4 — FSRS.** Integrate `ts-fsrs`; implement a small number of high-value `StudyItem` activity types first (comprehension + reading-in-context, per §12's explicit "start small"), wired to real `Review` inserts. Gate: scheduling logic unit-tested independent of any UI (per §21).
- **Phase 5 — Vocabulary/kanji relationships.** Build the UI for confirming `vocabularySuggestions`/spans into real `sentence_vocabulary`/`vocabulary_kanji` links; surface "this reading of this kanji occurs in these words" views.
- **Phase 6 — Anki interoperability.** Narrowed scope (§11): the one-time import already happened in Phase 2. This phase is now just verification/cleanup — confirm nothing further is needed from `anki`, archive it. No export-back-to-Anki path is built unless a concrete need surfaces later.
- **Phase 7 — Adaptive learning.** Populate `reviews.errorClassification` (manually at first, per §13's "don't overbuild automatic classification" instruction), and use review history to inform exercise selection.

---

## Summary of conclusions for review

1. **Canonical repo: `jp_sentence_splits`**, confirmed by evidence (mature sync engine, working PWA, and — most importantly — sole owner of the irreplaceable structural-analysis engine).
2. **`shadowing/cli` stays separate** (Python, external tool); **`shadowing/web`'s practice functionality gets ported in**, not kept running standalone.
3. **`anki` becomes a fully archived, one-time migration source** — confirmed acceptable by the user to migrate away from entirely. `anki_headless/` (already built, already tested against the real account) is used once to pull existing Satori/Shadowing sentences out, then has no further ongoing role. No live SQLite editing, no re-hosting Anki's own data model, no export back to Anki.
4. **FSRS via `ts-fsrs`** (verified current, actively maintained), cleanly isolated from content and UI.
5. **Kanji and VocabularyItem are new, first-class, relationally-linked entities** — the one piece of real net-new schema design in this whole plan; everything else is additive extension of what already exists and works.
6. **Single web-based ingestion path, by design**: CSV, `.shadowing.zip`, WaniKani-catalog, and JMDict content all get exactly one ongoing import path, directly into the unified web app — none of it requires importing into Anki or a separate app first. The one exception (the one-time Anki sentence backfill) is explicitly a single historical event, not a second ongoing pipeline.
7. **Anki review history is deliberately not migrated** — flagged as an explicit, permanent tradeoff the user has confirmed is acceptable, not an oversight.
8. Nothing in this plan requires a new backend service, a rewrite of working code, or discarding any existing repo's data.
