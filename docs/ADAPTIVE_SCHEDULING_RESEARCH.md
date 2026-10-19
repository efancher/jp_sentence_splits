# Adaptive scheduling and a learned practice graph

Research discussion: 2026-10-18. Status: proposed; implementation not started.
Tracked in [ROADMAP.md](ROADMAP.md), under Planned.

The user wants the system to account for different card types, choose appropriate
easier exercises or helpers, and learn scheduling relationships as practice
continues. This note preserves the findings and a proposed implementation path.
Code observations below were checked against local main at `d57fbbf`; no production
data completeness audit or learning-effect experiment was performed for this
research. Recheck implementation and migration status before building.

## Recommended direction

Keep FSRS as the initial memory/timing model. Add a practice policy that chooses
what to do, in which format, and with how much support. Its objective should be
better delayed understanding and transfer for the study time spent. Immediate
correctness, number of completed cards, and engagement alone are insufficient:
optimizing them could favor easy tasks or generous hints indefinitely.

Three responsibilities should remain explicit:

| Responsibility | Question |
| --- | --- |
| Memory model | How likely is this particular task to be remembered now or later? |
| Skill evidence | Which parts of the task appear secure, uncertain, or difficult? |
| Practice policy | Which available exercise or helper is most likely to improve later performance? |

FSRS updates each card's memory state after reviews. Fitting its shared parameters
to a review history is a separate operation. Different fitted parameter groups
could eventually improve timing for materially different task families, but they
would not by themselves learn which helper or related exercise to offer.

## Verified foundation and gaps

| Existing component | What can be reused | Limit or question to audit |
| --- | --- | --- |
| [scheduling.ts](../src/lib/scheduling.ts) | `scheduleReview`, `predictRetrievability`, separate state on each `StudyItem` | Uses `fsrs()` defaults. The scheduling call receives state, rating, and time; no card semantics or assistance. |
| [Review / StudyItem types](../src/domain/types.ts) and [recordReview](../src/db/repository.ts) | Activity and subject identity, context sentence, rating, assistance flags, response/expected answer, meaning-choice snapshot, missed readings, presentation, predicted retrievability | Optional fields and historical gaps require a coverage audit. `recordReview` schedules from the self-rating; objective checks remain supplementary. |
| [ReviewPage](../src/pages/ReviewPage.tsx) | Existing prompts, helpers, and objective observations | `elapsedMs` exists in the type/repository input but the inspected main `handleRate` call does not supply it. Assistance flags do not fully describe event order. |
| `GlossDecision` and [glossSkill.ts](../src/lib/glossSkill.ts) | First response/correctness, support level, hint depth, translation level, blocker, dispute/ungraded outcomes | Support changes through fixed rules. Word/form blockers are excluded from structural-weakness inference. No response-time field by design. |
| [sessionPlanner.ts](../src/lib/sessionPlanner.ts) | Ranking, reason strings, time allocation, existing routing hooks | These are heuristics, not estimates of an intervention's learning effect. Check which hooks are active in sentence-led mode. |
| Sentence learning events and game rounds | Other learning exposures and activity history | Sources have different meanings and persistence guarantees; game rounds are currently local-only. Do not treat all events as reviews or assume cross-device coverage. |

The missing link is a reliable sequence connecting the initial attempt, selected
help, and later independent performance. Existing logs can support descriptive
analysis, but do not yet establish which help caused improvement.

Current flow constraint: `sentenceLedFlow` defaults on. Vocabulary and grammar
drill cards are paused. Use `getIntroducedSentenceIds` /
`filterToIntroducedSentenceIds` for sentence eligibility; requiring vocabulary
card history would exclude newly imported sentences. See
[ARCHITECTURE.md](ARCHITECTURE.md), Learning mode. Content annotations may identify
a component without requiring a separate card or a demonstrated word-proficiency
state. A temporary helper need not create a permanent review obligation.

## What the graph should represent

Maintain two distinct relationship types:

1. **Content relationships:** a sentence uses a word, form, construction, or sound;
   an exercise tests a skill; a helper supports a particular component. Seed these
   from existing source-linked content and reviewed annotations. AI can propose
   relationships, but proposals need provenance and confidence.
2. **Learning-effect relationships:** using action A in context C improves later
   performance on target B relative to another action. Estimate these from
   comparative evidence, retaining uncertainty, sample support, and task/context.

Content similarity is a useful candidate generator, not proof of transfer or a
prerequisite. An easier task can help a harder task without the reverse effect
being equal. Some effects may be negligible or negative. Avoid a rigid universal
ladder or an all-to-all card graph; begin with a small set of skill/action families.
The graph does not initially require a graph database or a neural network.

Example candidate routes, all hypotheses rather than established effects:

| Evidence | Candidate action | Later evidence to seek |
| --- | --- | --- |
| Meaning understood, one reading missed | Brief reading practice for the word | Read it in another sentence without reading assistance |
| Words understood, relationship missed | Highlight the connection or show a simpler reviewed example | Interpret the relationship with the highlight removed, including in a fresh example |
| Reading succeeds, listening struggles | Replay a short native chunk, then remove the transcript | Understand a delayed audio-only attempt under a specified replay/speed condition |
| Familiar example succeeds, new example fails | Vary the context for the same construction | Understand an example not used during preparation |

A learned recommendation could say: "A shorter example has helped with this kind
of relationship; try one, then return with less support." Record the reason and
evidence strength. Use cautious default routes when there is little evidence.
An entire sentence passing does not prove every component mastered; an entire
sentence failing does not identify every component as weak. Retain "unknown"
when a blocker cannot be diagnosed, including when content itself may be faulty.

## Data contract to design before adding instrumentation

Extend and link existing append-only records where possible. The following is a
conceptual contract, not a requirement to create a new table for every row.

| Record | Minimum useful information |
| --- | --- |
| Decision | Stable decision ID, timestamp, session/visit, target and skill IDs, candidate actions and eligibility, chosen action, policy version, reason, context available before the choice |
| Model context | Task family, content/reference revision, FSRS state or reproducible snapshot reference, prediction, scheduler/configuration version, recent relevant exposure history |
| Attempt | Exercise identity and version, modality, response format, choices shown, support already visible, first response and objective result where reliable, self-rating stored separately |
| Intervention | Link to decision and originating attempt; help offered/requested/opened; kind and level; timing/order; relevant replay count/speed or translation visibility |
| Follow-up | Link to the intervention episode; delay; same item versus fresh transfer example; task/support conditions; independent result; intervening relevant exposures |
| Effort and completion | Completion/skip/abandonment, optional active duration excluding background time, availability of follow-up; missing outcomes remain missing |

For randomized decisions, store the actual probability of selecting the chosen
action under the logging policy, plus the eligible action set. A deterministic
choice has probability 1 for that choice and provides no direct evidence about
unselected alternatives. An estimated recall probability is not an action-selection
probability. Log assignment separately from whether the learner used the help.

Preserve event order: an eventual correct answer cannot reconstruct whether the
first answer preceded a hint. Store reference/content revisions so later edits do
not silently change the meaning of old observations. Keep disputed or unsettled
references out of correctness-based learning until resolved. Do not retroactively
invent missing timestamps, action probabilities, or helper usage.

Timing is optional evidence of effort, not a speed target or an automatic grade.
Record only useful events; avoid raw keystroke/audio collection for this purpose.
If new records are introduced, specify Dexie migration, remote mapping, RLS,
sync, backup/export, idempotent IDs, and deletion behavior together. Confirm remote
migrations are applied before relying on cross-device data. A joined evidence view
should retain source provenance and avoid counting one interaction twice.

## Preserve the meaning of a review

- Keep the user's FSRS rating authoritative in the initial slices. Neither helper
  use nor objective mismatch should silently rewrite it under this proposal.
- A helper interaction must not create a synthetic successful review or extend
  related cards' intervals. Assisted learning is valuable evidence about teaching,
  but does not establish unaided recall of the target.
- If help is requested before any independent attempt, independent performance is
  unknown, not automatically a failure. Assistance should remain available.
- "Independent" must be defined relative to the task: multiple-choice recognition
  without extra hints is still different from free recall or production. Different
  modalities and support configurations require distinguishable observations.
- Keep same-session repetitions separate from delayed checks; seeing the answer
  on a sibling task can prime a later response. Record that exposure rather than
  treating it as a fresh independent memory test.
- Keep the candidate pool and practice budget bounded. Include a route back to
  the original target and prevent indefinite easy-helper loops or starvation of
  due work. Validate existing sentence-led eligibility before adding any gate.

## Staged implementation and acceptance criteria

- [~] **0. Audit actual evidence and establish the baseline.** (Report tool and first
  findings below; sync/UI-path verification and reference-reliability review remain.) Produce a read-only
  report of counts, missing fields, join coverage, reference reliability, helper
  usage, and delayed/fresh-example opportunities by active task family. Separate
  historical legacy drills from current sentence-led activity. Verify sync and
  existing first-answer flags in their actual UI paths. Distinguish self-rated
  FSRS recall calibration from objective task accuracy; they are different labels.
  Deliverable: usable cohorts and explicit gaps, without claiming intervention
  effects from correlations.
- [~] **1. Connect attempt → help → follow-up.** (Gloss-decision slice built 2026-10-19: `retryOfId`, `helpSequence`, `helpBeforeFirstResponse`, `contentRevision`, `firstResponseMs`; still open: offered-versus-used help, delayed same-rule transfer checks, and sentence-card assistance. Review `elapsedMs` wired 2026-10-19: active time per card, hidden-page time excluded, recorded on every card rated via ReviewPage; rows before then stay null.) Choose one well-covered sentence
  task and helper. Add stable episode/decision links, content versions, event order,
  and offered-versus-used evidence. Accept when a real episode is reconstructible
  after reload/sync, incomplete attempts remain visible, and review writes occur
  exactly once through the existing rating path. Recording helper data alone must
  not mutate FSRS state.
- [ ] **2. Introduce a few explainable fixed routes.** Reuse existing helpers and
  source-grounded exercises. Integrate recommendations with the current review or
  planner flow and show a short reason. Accept when routes are usable with sentence
  history alone, support can fade, the original target is revisited, and due-work
  coverage and time costs can be measured. This becomes the policy baseline.
- [ ] **3. Learn which choices help.** Start with a small regularized or Bayesian
  model pooling evidence across similar skills/actions, with personalization only
  where supported. Update estimates as delayed outcomes arrive; retain uncertainty
  and fallback defaults. Consider a contextual bandit for a few suitable choices,
  with limited exploration and logged probabilities. Accept only with temporal
  validation and enough coverage to compare the candidate actions. There is no
  universal review-count threshold that guarantees reliable effects.
- [ ] **4. Evaluate learning and expand authority selectively.** Compare the learned
  policy with the fixed routes/current policy using delayed performance, transfer,
  and study time. Maintain a versioned fallback and monitor due coverage, skips,
  and helper loops. Consider task-family FSRS parameter fitting separately, with
  sufficient history and held-out calibration. Changing intervals, crediting
  cross-card learning, or learning long action sequences requires its own evidence
  and design; it is not an automatic consequence of better prediction.

Implement slices with focused tests for event semantics, joins, sync, unchanged
rating authority, and eligible candidate coverage. Browser-test the actual
attempt/help/revisit flow when UI changes begin. A documentation-only research
entry does not require application tests or migrations.

## Stage 0 findings (2026-10-19)

Tool: `npm run diagnose:routing-evidence` (`scripts/diagnose-routing-evidence.ts`,
pure logic in `scripts/lib/routingEvidenceAudit.ts`; read-only, `--json`,
`--since=`). It counts follow-up *opportunities*; it does not estimate effects.
First run against the cloud copy (3,464 reviews, 274 gloss decisions, 466
learning events; the cloud copy lags unsynced local data):

- **Review timing is absent:** `elapsed_ms` is null on every review. Effort
  cost per helper cannot be measured until the rating path supplies it.
- **Review assistance is unusable for sentence cards:** `reading_in_context`
  (the only current sentence card, 304 reviews since 2026-10-02) records
  `assistance` on 0%. Only listening (43%) and dictation (78%) record it.
  Meaning-pick/context-check coverage is 85%, predicted retrievability 73%.
- **Review misses rarely give a delayed check:** of 87 recent `again` ratings,
  72 were next seen within a day (relearning steps, so same-session repeats),
  only 12 after 1+ days. Neither assisted/unassisted nor skill is recorded.
- **Gloss decisions are the best-linked source** but small: 227 gradable
  attempts, only 18 first-attempt misses (17 particle, 1 attachment, 0
  predicate), 2 with a recorded blocker, 2 with help recorded. 8 have a later
  same-sentence attempt in another visit, 14 a later same-rule attempt on
  another sentence, 3 neither. Roughly 20 miss episodes is too few for any
  helper comparison, so near-term value is instrumentation, not modelling.
- **Learning events** (`target_practice`, recheck, held-back) barely exist
  yet: 2 practices, 1 `needed_help`, no follow-up.
- 523 reviews belong to soft-deleted/missing study items (legacy drills);
  exclude them from baselines.
- No disputed gloss decisions yet, so reference reliability by rule is
  untested.

Stage 1 gloss slice: re-run `npm run diagnose:routing-evidence` after use; `linkCoverage` shows how many new attempts carry each link. Rows before 2026-10-19 never will.

Note on assistance: `reading_in_context` offers no pre-answer helper (self-rating happens after Reveal; the only help before it is a link out to the guided gloss), so its 0% assistance is mostly accurate rather than a recording gap. Help used after Reveal (`ReadingHelpPanel`, gloss link) is not yet captured; add it only if the experiment needs it.

Implication: the first experiment cannot run on history. Stage 1 should
instrument gloss decisions (offered/used help, link to a delayed same-sentence
and same-rule check) and wait for volume; sentence-card assistance and
`elapsedMs` need wiring before reviews can contribute.

## First experiment

Question: after a sentence miss, does a targeted helper improve the next
independent attempt and transfer to another sentence using the same skill, for
the total time spent?

Choose a task with reliable reference answers, an observable blocker, a usable
helper, and enough source-grounded follow-up material. Compare a targeted-helper
recommendation with the existing feedback/revisit behavior. Continue to allow
requested help in both conditions. Log assignment and actual exposure separately;
the primary comparison should follow assignment to avoid selecting only learners
or episodes that complied with the recommendation.

Predefine the assessment task and delay window before inspecting results. For
example, a later-session check can assess the original target, and a separate
fresh example can assess transfer. The precise delay depends on actual usage;
record it and compare equivalent windows. "Fresh" should mean not used in the
preparation episode, with other prior exposure documented. Track missing follow-ups
and dropout explicitly rather than scoring them wrong or analyzing only completers
without reporting that selection.

Use comparisons among suitable actions in similar contexts. Passive data are
confounded: harder sentences may attract more help and still produce lower scores.
Randomization can address this, but related sentences can interfere with each
other; choose assignment units such as a target family or learning episode and
account for repeated observations. For a single learner, start with a few broad
action families and report uncertainty. Avoid dividing sparse data into many
sentence-specific rules or claiming general population effects.

Evaluate two separate questions:

| Question | Evidence |
| --- | --- |
| Does the model predict accurately? | Chronological holdouts, calibration/log loss or Brier score for the defined outcome, task/support breakdowns, no future observations in features |
| Does following the policy help? | Comparative delayed independent performance, transfer to held-out examples, total preparation/review time, follow-up coverage, skips and due-work coverage |

Report accuracy and time separately as well as any efficiency summary, so a gain
in speed cannot hide worse retention. Group or hold out related content when
testing transfer; memorized variants must not leak into a supposed novel-example
test. Offline policy evaluation requires overlap with actions actually sampled;
deterministic historical logs cannot establish arbitrary alternative policies'
effects. A contextual bandit handles a limited choice with an eventual outcome;
credit assignment across long sequences is a separate, harder problem.

## Primary research and what it supports

- [FSRS algorithm reference](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm):
  memory state, review updates, and forgetting-curve foundations. Use the installed
  library's version/configuration when replaying app history; a current web formula
  is not necessarily the version that generated an older prediction.
- [Anki FSRS parameter guidance](https://docs.ankiweb.net/manual/deck-options):
  optimization can fit different presets for materially different study material.
  This supports evaluating broad task-family timing differences, not creating a
  separate parameter set for every small category or claiming helper effects.
- [Nakagawa et al., graph-based knowledge tracing (2019)](https://www.jstage.jst.go.jp/article/pjsai/JSAI2019/0/JSAI2019_1Q3J203/_article/-char/en):
  explores both supplied and learned relationships between skills for predicting
  student performance. A learned predictive graph is not a validated causal
  prerequisite or intervention graph.
- [Shu et al., KARL, revised 2024](https://arxiv.org/html/2402.12291v3):
  combines card content and related history for recall prediction. Its online
  study used 32 six-day study paths from 27 users and reported comparable accuracy
  with faster recall against FSRS. Promising for content-aware practice, but not
  evidence that this proposed system improves long-term Japanese learning or that
  it will outperform the current app at its available data scale.
- [Settles and Meeder, half-life regression (2016)](https://aclanthology.org/P16-1174.pdf):
  demonstrates trainable language-learning memory models. Its discussion of sparse
  lexeme-feature overfitting is relevant: finer content features did not necessarily
  improve the learner experience. Prefer shared evidence and evaluate added
  complexity against simpler baselines.
- [Vowpal Wabbit contextual-bandit documentation](https://vowpalwabbit.org/docs/vowpal_wabbit/python/latest/tutorials/python_Contextual_bandits_and_Vowpal_Wabbit.html):
  explains context/action/reward learning and logging the selected action's
  probability. Supplies implementation mechanics, not evidence of educational
  efficacy or a solution to delayed sequence credit assignment.

Sources were consulted on 2026-10-18. The design recommendations here are a
synthesis for this app, not claims that these sources tested the proposed system.

## Open decisions for the next research/implementation pass

- Which active task has sufficient reliable observations and follow-up material
  for the first experiment? Decide from the coverage audit, not legacy card counts.
- What is the smallest useful skill/action taxonomy, and how will annotation
  confidence, revisions, and unsupported diagnoses be represented?
- Can existing records carry episode links, or is one append-only decision log
  needed? Which non-review exposure sources should be synchronized first?
- Which delayed horizon and transfer task best reflect the user's real objective:
  reading comprehension, listening, or production? Keep these outcomes distinct.
- How much extra practice time is acceptable, and when should the system return
  to the original task, defer, or let the learner choose?
- How should reliable improvements influence timing later, while preserving the
  interpretation of FSRS history? Parameter fitting and cross-task credit require
  separate validation from helper selection.

Immediate next deliverable: the read-only evidence-coverage report and a concrete
event contract for one attempt/helper/follow-up episode. Choose implementation
details after that report establishes what data and content are actually available.
