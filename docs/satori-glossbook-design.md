# Satori Glossbook — design

## Purpose

Satori Glossbook turns a full Satori Reader vocabulary CSV into a mobile-first analysis workspace: import → dedupe → books → ordered study → chunk/role/literal analysis → worksheet/practice.

It intentionally avoids SRS scheduling, Anki sync, accounts, and remote APIs.

## Architecture

```text
CSV file (device)
   → Papa Parse + Zod-validated domain merge
   → Dexie / IndexedDB
   → React UI (hash router)
   → optional JSON backup / worksheet export
```

- **React + TypeScript (strict) + Vite** static frontend
- **Dexie** for versioned IndexedDB persistence
- **Hash router** for GitHub Pages compatibility
- **vite-plugin-pwa** for installability and offline app shell
- No backend, no analytics, no translation APIs at runtime

Application identity (name, version, deploy base) is centralized in `src/appConfig.ts`.

## Data model

Core entities:

| Entity | Role |
| --- | --- |
| `Sentence` | Canonical imported Japanese sentence + vocab + source metadata |
| `SentenceAnalysis` | User chunk/role/literal work, stored separately from source text |
| `Book` | Named collection metadata |
| `BookSentence` | Join table: membership, order, study status, optional chapter |
| `ImportBatch` | Import history / counts / warnings |
| `InboxMembership` | Unassigned imported sentences |
| `Settings` | Theme, reveal defaults, last book, etc. |

### Why analysis is separate from imported source text

Reimports must be able to merge new vocabulary and fill missing readings/translations without wiping manual analysis. Keeping `SentenceAnalysis` keyed by `sentenceId` (stable normalized-Japanese id) preserves user work across CSV refreshes.

## Import and deduplication

1. Parse UTF-8 / UTF-8-BOM CSV with Papa Parse
2. For each row, iterate `Context1`–`Context3`, skipping empties
3. Normalize Japanese for identity:
   - decode entities / strip markup
   - trim, Unicode NFC
   - remove whitespace only
   - keep punctuation and casing as displayed separately
4. Merge JE/EJ and multi-vocab rows onto one sentence
5. Target vocabulary is structured objects (expression+reading stay paired)
6. Conflicts (different nonempty translations/readings) keep a preferred value and record alternatives

Reimport is idempotent: no duplicate sentences, vocab associations, or book memberships; analysis/order/status remain.

## Analysis representation

Each analysis has ordered `AnalysisChunk` objects:

- `japanese`
- `role` (preset string or custom)
- `literalEnglish`
- optional notes

Primary editing UX: spaced copy of the Japanese sentence. Heuristic chunking/role suggestion is a TypeScript port of `reference/satori_gloss.py` and is never authoritative.

Invariant: concatenating chunk Japanese (ignoring inserted spaces) must equal the normalized source sentence.

## Book ordering

`BookSentence.position` is the source of truth. Drag-and-drop and explicit Up/Down/Top/Bottom controls both rewrite positions transactionally. Automatic initial sorts (CSV occurrence, WhenCreated, JP/EN) are convenience only and do **not** claim to reconstruct Satori article order.

Chapters are ordered metadata embedded in a book. `BookSentence.chapterId`
assigns membership without changing the canonical sentence or analysis. Moving
a sentence to another book clears the source book's chapter assignment.

## PWA constraints

- Static hosting only
- Offline shell via service worker after first load
- Do not cache user CSV uploads as app assets
- Safe-area insets and 44px touch targets for iOS
- Input font-size ≥ 16px to avoid focus zoom

## Future sync strategy (not MVP)

Possible later additions:

- Authenticated sync (e.g. Supabase) with conflict-aware merge using `updatedAt` + sentence normalized keys
- Optional AI chunk/literal suggestions that write into analysis drafts, never silent overwrite
- Anki export / worksheet import / chapters / audio / PDF

The current schema already separates source sentences from analyses and uses stable ids to make a future sync layer feasible without rewriting the MVP model.
