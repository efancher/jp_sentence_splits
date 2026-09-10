---
name: feedback-hints-name-the-cause
description: corrective feedback should name the likely cause (esp. English-transfer), not just the instruction
metadata:
  type: feedback
---

When building corrective feedback for pronunciation / pitch accent, pair the
"what to do" with "why it happens" — especially the English-L1-transfer cause
(initial stress, utterance-final declination, marking prominence with loudness
instead of pitch). The user's own words: ChatGPT helped by saying "practise the
last mora extra high *because English speakers drop pitch on the last
syllable*" — the causal clause is what made it stick.

**Why:** a bare instruction ("say it higher") doesn't generalize; the cause
lets the learner predict the same error elsewhere.

**How to apply:** shipped 2026-09-10 as `src/lib/pitchAccentCorrections.ts`
(`diagnosePitchAccentDeviation` → `TimingObservation.hint`, rendered "Try
this:"). Same principle for any future pronunciation-coaching copy. Related:
[[skill-over-metalabel-quiz]], [[measured-over-symbolic-pitch]].
