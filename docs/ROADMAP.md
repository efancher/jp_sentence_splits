# Roadmap

Phases match `docs/UNIFIED_APP_ARCHITECTURE.md` §15 (adjusted after
inspection; see that doc for full rationale). Update the checkbox and add a
one-line note when a phase's status changes — keep `STATUS.md` as the
detailed record, this file as the at-a-glance list.

- [x] **Phase 0 — Repository analysis.** `docs/UNIFIED_APP_ARCHITECTURE.md`.
- [x] **Phase 1 — Unified data model.** New Dexie/Postgres tables, additive, tested. Migration applied to live Supabase (2026-08-13).
- [x] **Phase 2 — Existing data migration.** WaniKani kanji catalog importer run against production (2101 rows). One-time `anki_headless`-mediated import of Satori/Shadowing Anki notes run against production (16 new sentences, 142 merged, 332 new vocabulary items, 500 links, 158 inbox entries — idempotency-verified). JMDict scoped down to a local lookup tool (`npm run jmdict:lookup`) — bulk-populating `vocabulary_items` deliberately deferred to Phase 5 (see STATUS.md), not a gap in this phase.
- [ ] **Phase 3 — Unified shadowing.** Port `shadowing/web`'s recording/comparison/pitch-analysis into this app as a new practice route; new `attempts` table, local-first.
- [ ] **Phase 4 — FSRS.** Integrate `ts-fsrs`; a small number of high-value `StudyItem` activity types first.
- [ ] **Phase 5 — Vocabulary/kanji relationships.** UI to confirm suggestions into real `sentence_vocabulary`/`vocabulary_kanji` links.
- [ ] **Phase 6 — Anki interoperability cleanup.** Verify nothing further is needed from `anki`; archive it. No export-back-to-Anki planned.
- [ ] **Phase 7 — Adaptive learning.** `reviews.errorClassification` usage (manual first), review history informing exercise selection.
