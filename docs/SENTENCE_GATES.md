# What unlocks a sentence

Verified against code 2026-10-02. Two layers: *opening* a sentence for study
(sequential mode, optional) and *which activities* a sentence qualifies for.

## 1. Opening a sentence (`src/lib/sequentialStudy.ts`, only when `settings.sequentialStudyMode`)

```mermaid
flowchart TD
  S[Sentence N+1 in a book] --> L{Latched in<br/>sequentialUnlockOverrides?}
  L -- yes --> OPEN[Open]
  L -- no --> I{Already started, walked through,<br/>or has attempts?}
  I -- yes --> OPEN
  I -- no --> F{First sentence of book?}
  F -- yes --> OPEN
  F -- no --> P{Sentence N open?}
  P -- no --> LOCK[Locked: Analyze shows Japanese +<br/>'Not unlocked yet' + manual unlock]
  P -- yes --> C{Last 5 qualifying attempts on N:<br/>>= 4 correct?}
  C -- yes --> OPEN
  C -- no --> W{N has no usable meaning check<br/>AND N was itself worked on?}
  W -- yes --> OPEN2[Open, not latched]
  W -- no --> LOCK
```

Qualifying attempt = first pick on a meaning card, before any hint/translation,
at least 10 minutes after the previously counted attempt. Unlocks are latched
(permanent) except the waiver case. Each book is independent.

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
