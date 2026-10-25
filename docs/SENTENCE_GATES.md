# What unlocks a sentence

Verified against code 2026-10-02. Two layers: *opening* a sentence for study
(sequential mode, optional) and *which activities* a sentence qualifies for.

## 1. Opening a sentence (`src/lib/sequentialStudy.ts`, only when `settings.sequentialStudyMode`)

Updated 2026-10-25: order inside an episode is a preference, not a gate. Each
chapter is an episode (chapterless sentences share one).

```mermaid
flowchart TD
  S[Sentence in an episode] --> L{Latched in<br/>sequentialUnlockOverrides?}
  L -- yes --> OPEN[Open]
  L -- no --> I{Already started, walked through,<br/>or has attempts?}
  I -- yes --> OPEN
  I -- no --> E{Any other sentence of the episode<br/>started / walked / attempted?}
  E -- yes --> OPEN
  E -- no --> F{First sentence of the episode?}
  F -- yes --> OPEN
  F -- no --> LOCK[Locked: Analyze shows Japanese +<br/>'Not unlocked yet' + manual unlock]
```

Unlocks are latched (permanent). A latch alone never counts as "started".
Candidate order (`findExploreCandidates`, sequential mode only): sentences from
episodes with the most learnt sentences come first (position order within an
episode); across books, the book whose leading episode is furthest along goes
first, then the usual recency/ease ordering.

## 2. Activity gates

Default is the sentence-led flow (`sentenceLedFlow`, on): word/grammar drills
are withheld and sentence cards are gated only by having been introduced via
the gloss walkthrough. The vocabulary gates below apply to the legacy path
(`sentenceLedFlow: false`) and to the planner/shadowing/games.

```mermaid
flowchart TD
  V{Vocab confirmed?<br/>analysis.vocabularyReviewStatus} -- no --> VR[Only a vocabulary_review step]
  V -- yes --> A[continue_book glossing:<br/>>= 50% of linked words introduced<br/>reading/meaning card out of 'new']
  V -- yes --> SH[Shadowing:<br/>100% introduced + reference audio + active book<br/>no pitch requirement]
  V -- yes --> FR[Full-sentence cards legacy path:<br/>every word FSRS review/relearning<br/>+ passage neighbours ready, reading_in_context]
  FR --> LI[listening: + audio, every word_listening proficient,<br/>pitch_accent proficient unless paused]
  V -- yes --> PP[Particle Puzzle: 100% introduced]
```

Other gates: `word_listening` and contrastive pairs need reading-only FSRS
proficiency of the word; `grammar_completion` needs the pattern's
`grammar_recognition` proficient; `conjugation` uses the full-review gate.
