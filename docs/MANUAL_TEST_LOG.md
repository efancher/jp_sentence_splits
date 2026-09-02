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

**Mechanism** (`ReviewPage.tsx` ~L1005–1038 + `pickContextSentenceForGrammarPattern`
in `repository.ts` L4239):

- A tracked grammar pattern only produces *any* review card
  (`grammar_comprehension` / `_completion` / `_contrast` / `_production`) if
  `pickContextSentenceForGrammarPattern` returns a context sentence.
- That function walks the pattern's `sentenceGrammar`-linked sentences and
  returns the first one passing `getSentenceFullReviewReadiness` — i.e.
  `vocabularyReviewStatus === 'confirmed'` **and every** vocab item in that
  sentence FSRS-proficient (the same bar as full-sentence review + shadowing
  candidates).
- If none of the pattern's example sentences clears that bar, the pattern is
  dropped from `grammarCandidates` entirely (`if (!context) continue;`), so
  `getDueStudyItems` is never even asked about its due items → **zero cards,
  silently**, while the study item still reads "due".
- Unlike sentence-subject cards, grammar has **no `deferUnreadySentenceReviews`
  equivalent**, so the stuck items keep inflating the planner's review count
  and the Study-items due list indefinitely.

**Why it bites:** patterns are tracked from sentences you *just analyzed* —
exactly the ones whose vocab isn't proficient yet. A freshly-tracked pattern
is the most likely to be stuck.

**Confirm on your end:** ☰ → Grammar → open a pattern that shows as due →
check its example sentences. If none has all vocab confirmed **and** every
word matured/proficient, that's the cause.

**Fix options (needs a scope decision — touches the vocab-before-glossing
principle):**
- A. Relax the context pick for `grammar_comprehension`/`_completion`: they
  show the pattern's meaning and use the sentence only as a reveal example,
  so they don't need the example's vocab individually mastered. Prefer a
  ready sentence, fall back to the most recent linked one. Keep the strict
  gate for `grammar_production` only (or drop it there too).
- B. Add a grammar deferral pass mirroring `deferUnreadySentenceReviews` so
  stuck cards stop inflating planner/Study-items counts, + surface "N grammar
  cards waiting on vocabulary" somewhere.
- C. Both.

## Corruption spot-checks (run after any writing test)

- Settings → "Export all data" downloads a JSON without error (DB-integrity
  proxy).
- ☰ → Study items — no card with an absurd due date (1970 / far future).
- ☰ → Progress — counts moved in the expected direction.
- Sync badge (header) — no conflict indicator.
