---
name: project_shadowpage_collapsed
description: ShadowPage layout after the 2026-09-09 collapse — close-shadow loop on top, record/analyze below; guided panel gone
metadata:
  type: project
---

2026-09-09 (user request): `ShadowPage` was collapsed. The user in practice
only ever used the close-shadow **looping** and the free-form **record +
analyze**, so everything else was cut.

Current layout (top → bottom):
1. Reference player — audio, playback speed, Mark start / Mark end / Loop target.
2. **Close shadow** panel — only the hands-free "Loop shadow reps" toggle +
   live waveform + rep counter, plus Hear-that-back / Compare-to-native for
   the last rep. Reps are **ephemeral, never saved**. Speed and the target
   range are adjustable *while the loop runs* (`ShadowingController.updateShadowLoop`
   → `ShadowReferencePlayer.setPlaybackRate` / `seek`; `startShadowLoop` has a
   `range` option; `tickShadowLoop` wraps a sub-range without waiting for the
   clip's real end).
3. **Record & analyze** panel — Calibrate mic, one plain Record toggle,
   save/discard, then the Past-attempts list with inline `AnalysisPanel`.

Removed: `ProgressiveShadowingPanel` + `useProgressiveShadowing` (the 5-stage
Listen→Pause&Repeat→Delayed Shadow→Close Shadow→Record&Compare flow), the
free-form "Delayed shadow" + delay picker, the "Shadow mode" checkbox,
`PlaybackCoordinator.playRange`. `Attempt.practiceStage` / `practiceSessionId`
left in the schema as dead optional fields (one planner test still uses them).

See [[feedback_prefer_in_context_over_isolated]], [[feedback_skill_over_metalabel_quiz]].
