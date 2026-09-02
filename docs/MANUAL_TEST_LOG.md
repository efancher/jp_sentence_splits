# Manual test log

Hands-on verification of shipped features, tracked incrementally. The user
tests during day-to-day use and reports back; update the status + date here
as items are confirmed. This is the "browser-verified" record that STATUS.md
points at.

Validation bar for this personal app: (1) no data corruption, (2) the
feature is reachable/accessible. Not full e2e coverage.

Status key: ✅ verified · ⚠️ issue found · ⬜ not yet tested · 🔁 needs re-test

## 2026-09-02 feature pass

| # | Feature | How to reach it | Status | Notes |
|---|---|---|---|---|
| 1 | Read-only screens: Progress / Pronunciation profile / Pitch-accent drill load | ☰ → Progress; Home shortcut row → "Pronunciation" / "Pitch-accent drill" | ✅ 2026-09-02 | iOS Safari |
| 2a | `reading_in_context` passage framing | `/review` — card shows greyed neighbour sentences above target | ⬜ | |
| 2b | `word_listening` audio cloze (whole clip → blanked sentence → answer) | `/review` | ⬜ | |
| 2c | `pitch_accent` audio-first, pick-where-pitch-falls (contour choices) | `/review` | ⬜ | |
| 2d | `pitch_accent` citation-form-only (no inflected occurrences quizzed) | `/review` | ⬜ | |
| 2e | `sentence_transformation` conjugation card (type the inflected form) | `/review` | ⬜ | |
| 2f | `grammar_production` card (free sentence → reveal model) | `/review` | ⚠️ 2026-09-02 | No grammar cards (comprehension *or* production) appear in `/review` even though grammar study items show as due. Root cause identified — see below. |
| 2g | H/L pitch row above rating buttons on sentence cards | `/review` | ✅ 2026-09-02 | iOS Safari |
| 2h | Sibling burying — no two cards for same subject back-to-back | `/review` | ⚠️ 2026-09-02 | Works on iOS Safari. On work Linux / Firefox it looked like it wasn't happening — needs confirmation whether that machine actually had sibling pairs due at the time, or it's a real gap. See below. |
| 3 | Session planner new-card backlog ("Review N due + introduce M new", step stays open through seeding) | Home → start today's session → review step | ✅ 2026-09-02 | |
| 4 | VocabularyPicker flags blank-meaning selections on confirm | ☰ → Books → sentence → Vocabulary → confirm a word with no meaning | ⬜ | |
| 5 | Mining wizard W1–W6 (Transcript→Segment→Translate→Commit) | ☰ → Import from YouTube | ⬜ | Use a short NEW video; after commit check ☰ → Books for exactly one new book, no duplicate |
| 6 | `/pitch-accent` drill records + scores contour vs dictionary | Home shortcut row → "Pitch-accent drill" | ⬜ | Needs mic + an eligible sentence; "nothing to practice" is a valid state |

## Open questions / issues

### 2h — sibling burying not observed on Firefox / work Linux

Sibling burying is pure queue-build logic in `ReviewPage` (keeps at most one
due card per `subjectType:subjectId` in the stable review/relearning state)
— it is browser-agnostic, no platform API involved. Most likely explanations,
in order:

1. That machine's `/review` queue simply didn't have sibling pairs due at
   that moment (needs ≥2 activities for the same word/sentence, both in
   `review`/`relearning`, both due). `new`/`learning` items are exempt by
   design.
2. Sync hadn't propagated — the work machine had older `StudyItem` state.
3. A real gap.

To narrow it down next time on that machine: ☰ → Study items, look for two
rows with the same subject label, both `state: review`, both due today. If
they exist and both still show up consecutively in `/review`, it's a real
bug — capture the two subject labels + activity types.

### 2f — no grammar cards despite due study items

**Investigated 2026-09-02** with `scripts/diagnose-grammar-review-queue.ts`
(read-only) + an ad-hoc orphan sweep. Root cause is **not** the readiness
gate — it's orphaned study items from the 2026-09-01 "After Work" /
"GLIM SPANKY" sentence soft-deletes.

Findings (production):
- 13 grammar patterns have study items; **all 13** have ≥1 due card;
  **0** currently render.
- **11 of 13**: their single `sentence_grammar` link was soft-deleted along
  with the sentence it pointed at. `pickContextSentenceForGrammarPattern`
  returns undefined at `if (links.length === 0)`, so the pattern is dropped
  from candidates before the due-check — the `grammar_comprehension` /
  `grammar_completion` study items (subjectType `grammarPattern`) survived
  the cascade and are now stuck-due forever, invisible.
- **2 of 13** (`～ている（状態描写）`, `～を見つける`): genuinely gated — their
  one live linked sentence (`sent_959`) has `vocabulary_review_status !=
  'confirmed'`. Minor; separate question.
- Same cascade gap hit other activity types: **20 `sentenceVocabulary`-subject
  study items orphaned** (`word_listening` / `sentence_transformation`, 10
  due), **3 `vocabularyItem`-subject orphaned & due**. `sentence`-subject
  items were correctly dropped (0 orphan).

**The bug** — `cascadeRetireSentenceLocal` (`repository.ts` L342):
```
.filter((item) => item.subjectType === 'sentence' && !keepStudyItemIds.has(item.id));
```
It deletes only `subjectType: 'sentence'` study items. It deletes the
sentence's `sentenceVocabulary` links (L316) but not the `word_listening` /
`sentence_transformation` study items keyed to those link ids, nor considers
`grammarPattern` study items whose last live occurrence was this sentence.

**Fix (proposed, needs go-ahead — production data mutation):**
1. One-time cleanup script: soft-delete the orphaned study items (the 11
   grammar patterns' items, the 20 `sentenceVocabulary` items, the 3 vocab
   items) — via the normal queued `delete`, never raw DELETE.
2. `cascadeRetireSentenceLocal`: also retire `sentenceVocabulary`-subject
   study items for each link it deletes. For `grammarPattern`-subject items,
   retire only when the deleted link was the pattern's last live
   `sentence_grammar` row (else leave it — the pattern may recur elsewhere).
3. Open question for the 2 vocab-gated patterns: leave them (honors
   vocab-before-glossing) or let grammar review fall back to a
   not-fully-ready sentence. Deferred — only 2 cards.

Diagnostic: `npx tsx scripts/diagnose-grammar-review-queue.ts`

## Corruption spot-checks (run after any writing test)

- Settings → "Export all data" downloads a JSON without error (DB-integrity
  proxy).
- ☰ → Study items — no card with an absurd due date (1970 / far future).
- ☰ → Progress — counts moved in the expected direction.
- Sync badge (header) — no conflict indicator.
