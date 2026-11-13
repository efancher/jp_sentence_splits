# Assistant model evaluation plan (proposal)

Status: milestone 1 run, decision made (2026-11-13): **keep Claude Haiku 5.5 as the
default; no switch.** `/assist` accepts `model` and `effort` for the requested backend
(deployed), and `scripts/assist-model-eval.ts` (`sample` / `run` / `report`, helpers in
`src/lib/assistModelEval.ts`) samples 10-sentence windows from the user's books, runs them
through the arms, scores them with `validateExtraReply`, and writes a blind review sheet.
Milestones 2-3 remain proposals. Origin: a critique of an external
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

## Milestone 1 results (2026-11-13)

3 windows (30 sentences) x 3 extras kinds (structure, particles, comprehension), one run per
cell. Pass = the app's structural validator only.

| Arm | Runs | Passed | Median seconds |
| --- | --- | --- | --- |
| A Haiku 5.5 (current default) | 9 | 9 | 36 |
| B Kimi K3 | 9 | 9 | 72 |
| E Kimi K3.1 Pro | 9 | 9 | 106 |
| B Qwen3.8 Max (partial) | 6 | 6 | 623 |
| B GLM-5.3 (partial) | 5 | 2 | 260 |

- Blind side-by-side review: the user spot-checked some windows and saw no large
  differences, so there is no quality case for switching. Haiku is the fastest arm.
- Cost: the 18 Kimi calls used about 22 points of the Go weekly allowance and 11 of the
  monthly one (one rolling window to 55%); K3.1 Pro is the heavy one. Quota is limited
  (weekly resets in days), so repeat runs need pacing (`--pause`).
- GLM and Qwen were cut after the first pass hit the rolling limit; their rows are partial
  and not comparable. GLM's failures were not investigated.
- Kimi K3 is the viable alternate backend if load ever needs to come off Claude.
- Free OpenCode (Zen) models (`glm-5.3-flash-free`, `deepseek-v4.1-flash-free`,
  `minimax-m3.1-flash-free`, `big-pickle`) hang through the `assist` agent: any tool
  restriction (deny-all permissions, tools off, all-but-one off) stalls them, while an
  unrestricted agent replies in seconds. Paid Go models are unaffected. Using them would
  need a looser agent config (tools reachable in a temp directory), so they were dropped.
  The four `F-*` arms remain in `DEFAULT_ARMS` for a future retry.
- Not done: milestone 2 (UniDic hints) and the verifier arm; revisit only if extras
  quality becomes a problem.

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
