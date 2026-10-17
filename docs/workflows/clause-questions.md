# Prepare upgraded sentence questions

Use this workflow to add or revise ungraded questions, review missing coverage, or
prepare newly imported or resumed material. The user-facing entry point is
“Try a clause question (preview)” in the sentence walkthrough. It also supports
simpler sentence relationships (objects, subjects, modifiers, time and place).

## Inventory the requested scope

Work in an isolated checkout. The current account is accessed using the existing
`createScriptSupabaseClient` helper and script credentials; never copy credentials
into commands, prompts, reports or the repository. With the normal script
environment loaded, run:

```sh
npm run questions:coverage -- --output /tmp/question-coverage.json
```

The output must be a new filename. It is written with private file permissions
and contains personal sentence text; keep exports out of commits. This command
only reads Supabase. It paginates owner-scoped, nondeleted records and uses the
app's book rotation rules: archived/suspended books and suspended chapters are
excluded. A shared sentence counts once if any membership is active. Memberships
retain book/chapter names and positions, so repeated placements are not mistaken
for additional unique sentences. Honor a user's explicit scope override rather
than silently changing their suspension settings.

The report has `counts` (`ready`, `reviewed`, `missing`), `activeMemberships`, and
`sentences`. Each sentence includes its exact Japanese, translation, memberships,
and current question/reference or review-note status. Re-export when the scope or
source text changes. It is a point-in-time report, not a live lock on learner data.

## Author and review

- Add full reference objects to `src/data/activeClauseQuestions.json`; the original
  pilot remains in `src/data/clausePilot.ts`. Fields: `id`, `source`, `targetText`,
  `question`, `options`, `answerText`, `explanation`.
- Use exact current source text. Target and every option must occur exactly once
  in that source, with at least two distinct options and the answer among them.
  These are text spans, not chunk IDs; do not change chunks to fit a question.
- Choose a clear local grammatical relationship. Distinguish the noun directly
  modified from a coreferent noun, quoted content from its introducing predicate,
  topics from subjects, and a following linked clause from an inferred causal or
  temporal interpretation. Review both the answer and why the distractor fails.
- An unfinished sentence may still contain a complete local noun modifier,
  object–predicate relation, or nominalization. Prefer such a question when it
  does not rely on the missing continuation; explain the limited scope.
- Prefer a useful simpler relationship when no multi-clause question fits. Do not
  fill coverage with arbitrary distractors or invent missing context. Fragmented
  transcripts, greetings and genuinely unsuitable cases can receive an exact-source
  note in `src/data/clauseReviewNotes.json`: `id`, `source`, `reason`. Say why a
  question was not selected; do not claim it is permanently impossible.
- One question OR review note per exact source. A source edit expires either and
  shows “not prepared yet”. Never add a note merely to hide unreviewed work.
- Keep IDs stable for unchanged questions. Increment the revision suffix when
  changing an existing question/answer/explanation so old feedback is not silently
  attached to new content. Remove an old note when a source gains a question.
- These are assistant-drafted, self-reviewed references unless independent review
  actually occurred. Keep them ungraded; no FSRS, review or evidence writes.

The walkthrough displays “Upgraded question not prepared yet” for uncovered text,
or “Reviewed — no upgraded question yet” with the reason. Both invite the learner
to request preparation later. A reviewed note is not counted as a ready question.

## Validate and publish within the user's authorization

```sh
npm run questions:coverage -- --check
npm test -- tests/clausePilot.test.tsx tests/clauseQuestionCoverage.test.ts
npm run typecheck
```

`--check` needs no credentials/network and rejects duplicate IDs/sources, invalid
spans, blank question/explanation/reason fields and note/question overlap. It does
not validate Japanese grammar: inspect the sentence and each proposed relation.
Update count assertions and the coverage summary when expanding the catalog.
Re-export coverage to prove the actual requested scope has no unaccounted gaps;
report ready/reviewed/missing counts separately. Do not call “reviewed” coverage a
question on every sentence.

Browser coverage in `e2e/clause-pilot.spec.ts` checks preview feedback, missing and
reviewed notices, and unchanged learner counts at phone/desktop widths. GitHub
runs Chromium/WebKit and the full suite/build. For UI changes, inspect these
results before merging. Follow the session's merge/deploy authorization; the
skill itself grants no new publication permission. After publishing, confirm the
Pages deployment and provide a direct `/books/<bookId>/learn/<sentenceId>` link.

## Coverage snapshot

The active inventory reviewed on 2026-10-16 contained 449 unique sentence IDs in
493 active memberships: 398 ready questions, 51 reviewed notes, 0 unprepared.
The complete bundled catalog has 416 questions (including 18 earlier pilot
questions outside this active scope). All 449 texts were inspected individually;
question wording uses shared forms for recurring grammatical relations. The
references are self-reviewed drafts, not a grammar accuracy benchmark. The 51
notes include greetings, list fragments, unfinished clauses and short statements
without a useful contrast selected in this pass. They can be revisited later.

A follow-up review recovered 12 local relationships within previously deferred
sources: the same active scope now has 410 ready questions and 39 review notes
(428 questions in the complete catalog). Missing continuations are not inferred.
