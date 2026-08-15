# Roadmap

Phases match `docs/UNIFIED_APP_ARCHITECTURE.md` §15 (adjusted after
inspection; see that doc for full rationale). Update the checkbox and add a
one-line note when a phase's status changes — keep `STATUS.md` as the
detailed record, this file as the at-a-glance list.

- [x] **Phase 0 — Repository analysis.** `docs/UNIFIED_APP_ARCHITECTURE.md`.
- [x] **Phase 1 — Unified data model.** New Dexie/Postgres tables, additive, tested. Migration applied to live Supabase (2026-08-13).
- [x] **Phase 2 — Existing data migration.** WaniKani kanji catalog importer run against production (2101 rows). One-time `anki_headless`-mediated import of Satori/Shadowing Anki notes run against production (16 new sentences, 142 merged, 332 new vocabulary items, 500 links, 158 inbox entries — idempotency-verified). JMDict scoped down to a local lookup tool (`npm run jmdict:lookup`) — bulk-populating `vocabulary_items` deliberately deferred to Phase 5 (see STATUS.md), not a gap in this phase.
- [x] **Phase 3 — Unified shadowing.** Core loop done and manually verified (record/save/compare/rate, new local-only `attempts` table, `ShadowPage` route) — real-browser smoke test on Mac passed 2026-08-14. Pitch-analysis (`pitch.ts`/`japanese.ts`) and the live recording overlay deliberately deferred to a follow-up pass.
- [~] **Phase 4 — FSRS.** `ts-fsrs` integrated (`src/lib/scheduling.ts`); two activity types wired end-to-end (`comprehension`, `reading_in_context`) via a new `/review` (global) and `/books/:bookId/review` (scoped) queue — see STATUS.md. Pending a real-browser manual smoke test. Real UI differentiation between activity types, further activity types, and error-classification population all deferred.
- [~] **Phase 5 — Vocabulary/kanji relationships.** `VocabularyPicker`'s confirm action now materializes real `vocabulary_items`/`sentence_vocabulary`/`kanji`/`vocabulary_kanji` rows (all four sync-wired), plus new `/vocabulary` and `/kanji/:character` browsing pages — see STATUS.md. Pending a real-browser manual smoke test. Deferred to "Phase 5 part 2": JMDict-based meaning backfill, and retroactive materialization for sentences confirmed before this shipped.
- [x] **Phase 6 — Anki interoperability cleanup.** Verified no further content needed (no `anki` commits since the 2026-08-14 migration tooling landed; Phase 2's import already ran clean, 0 skipped) and archived `efancher/anki` on GitHub — see STATUS.md. No export-back-to-Anki planned.
- [ ] **Phase 7 — Adaptive learning.** `reviews.errorClassification` usage (manual first), review history informing exercise selection.
