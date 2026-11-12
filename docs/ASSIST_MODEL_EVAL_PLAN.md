# Assistant model evaluation plan (proposal)

Status: milestone 1 code written, not yet run (2026-11-12): `/assist` accepts `model` and
`effort` for the requested backend (not yet deployed to the box), and
`scripts/assist-model-eval.ts` (`sample` / `run` / `report`, helpers in
`src/lib/assistModelEval.ts`) samples 10-sentence windows from the user's books, runs them
through the arms, scores them with `validateExtraReply`, and writes a blind review sheet.
No results yet; milestones 2-3 are proposals. Origin: a critique of an external
"high-accuracy, low-cost Japanese analysis engine" prompt against this codebase. Most of
that prompt already exists here (UniDic morphology in the mining service, 10-sentence
extras calls with context, validators and repair in `src/lib/`, a multi-backend
assistant). The real gaps are a way to compare models, deterministic cross-checks of
model claims, and cost/usage accounting.

## Goal

Find out whether a cheaper model on the flat OpenCode Go plan (GLM-5.3, Qwen3.8 Max,
Kimi K3) produces extras as good as the current default (Claude Haiku 5.5, medium), with
and without UniDic facts in the prompt. Decide from measurements, not vendor claims.

## Decisions already made

- No hand-graded gold set. Quality is judged by automated checks plus a short blind
  side-by-side review (about 20-25 sentences, model names hidden, roughly 30 minutes).
- Use the flat Go plan; no metered provider and no spend limits needed.
- Skip a verifier or ensemble arm until the first results show a specific remaining
  error type.

## Open risk

OpenCode Go is documented as designed for OpenCode and similar coding agents, with
traffic monitored. Automated `opencode run` batches from the service are a grey area;
read the current terms before relying on it. Keep opencode last in the try-order.

## Milestones

1. **Harness and baseline.**
   - Per-request model override on `/assist` (the model is fixed per backend by
     config today).
   - `scripts/` harness reusing `buildExtraPrompt` / `validateExtraReply`, run over
     about 30 sentences from the user's own books (ambiguous particles, omitted
     subjects, passive/causative, spoken fragments).
   - Arms: A current Haiku medium; B GLM-5.3, Qwen3.8 Max, Kimi K3; E a stronger model
     already on the user's plans, as a ceiling.
   - Record validator pass rate, repair rounds, latency and any usage the CLI reports
     (unconfirmed that `opencode run` exposes allowance cost).
2. **Deterministic hints.** Arm C: feed per-sentence morphology (lemma, conjugation)
   into the prompt and cross-check the reply's lemma/conjugation/span claims against
   UniDic. Measure against milestone 1.
3. **Decision gate.** Switch the default only if a cheaper arm is close to the ceiling
   on the blind review and automated checks. Build a verifier or escalation tier only
   for an error type milestones 1-2 actually show.

## Parked

Metered-provider gateway and spend limits, multi-model ensemble, Anki card generation,
a coding-assistant model router. Revisit only if the gate shows a need.
