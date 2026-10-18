# Performance baseline — 2026-10-18

Measured locally against application revision `9e2f096` with the performance harness on
`codex/performance-baselines`. Production build: host Node 24.19.0. Browsers:
`mcr.microsoft.com/playwright:v1.61.1-jammy`, Chromium 149.0.7827.55 and WebKit 26.5.
One worker, zero injected latency, five observations per cell. These are host/container
measurements; the phone profile is emulated. No other test/build jobs were run
concurrently with this final timing run. Background host services were not controlled.

All 16 browser cases passed (240 observations), with no application errors or external
requests. All 8 usage/summary unit tests and all 12 Postgres integration tests passed.
Production build, performance-harness typecheck, lint (36 existing warnings, no errors)
and whitespace checks passed. No GitHub Actions run or production deployment is claimed.

## Observations

Global Review is the strongest scaling concern in this fixture: warm median increases
from 0.33 s to 3.89 s in Chromium, and from 0.88 s to 7.96 s in WebKit. Home also grows
with history size. Books and the chapter Reader remain comparatively quick. These
timings suggest where to profile next; they do not isolate a particular query or prove
how the current personal library behaves. All fixture sentence cards are deliberately
due, with no vocabulary links or audio; richer libraries may have different costs.

Small = 200 sentences / 1,000 reviews; large = 4,000 sentences / 20,000 reviews.
Setup/seed time is excluded. Values below are median milliseconds; five samples are
insufficient for a useful p95, so none is claimed.

| Browser/profile | Library | Screen | Document ms | Warm ms | Offline ms |
| --- | --- | --- | ---: | ---: | ---: |
| chromium-desktop | small | Home | 1004.8 | 82.6 | 91.5 |
| chromium-desktop | small | Books | 978.5 | 44.8 | 46.8 |
| chromium-desktop | small | Reader | 1029.7 | 82.4 | 79.9 |
| chromium-desktop | small | Review | 994.5 | 326.1 | 330.4 |
| chromium-desktop | large | Home | 1033.2 | 911.6 | 900.5 |
| chromium-desktop | large | Books | 1014.3 | 88.4 | 74.8 |
| chromium-desktop | large | Reader | 1044.2 | 98.9 | 114.0 |
| chromium-desktop | large | Review | 4269.2 | 3891.4 | 3380.6 |
| webkit-phone | small | Home | 1675.0 | 418.0 | 524.0 |
| webkit-phone | small | Books | 822.0 | 233.0 | 239.0 |
| webkit-phone | small | Reader | 780.0 | 219.0 | 267.0 |
| webkit-phone | small | Review | 1207.0 | 875.0 | 864.0 |
| webkit-phone | large | Home | 2232.0 | 1653.0 | 1580.0 |
| webkit-phone | large | Books | 1161.0 | 237.0 | 290.0 |
| webkit-phone | large | Reader | 737.0 | 309.0 | 283.0 |
| webkit-phone | large | Review | 8656.0 | 7962.0 | 7451.0 |

Document means a fresh JavaScript runtime with preseeded local data and HTTP cache
disabled. Warm/offline mean navigation to a primed screen. Timings include automation
overhead and two animation frames. See [measurement details](PERFORMANCE.md).

## HTTP body measurements

These use real local Postgres/PostgREST for sync and synthetic HTTP responses for
Storage. Bytes are decoded request/response bodies, not wire traffic or billed egress.
An unchanged sync still checks the event cursor; cached audio transfers nothing.

| Scenario | Requests | Request body bytes | Response body bytes |
| --- | ---: | ---: | ---: |
| sync-first-pull-120-books | 4 | 0 | 72040 |
| sync-unchanged | 1 | 0 | 2 |
| sync-one-remote-edit | 2 | 0 | 602 |
| sync-reconnect-120-books | 4 | 0 | 72028 |
| sync-import-120-books | 8 | 43703 | 21384 |
| audio-restore-four-clips | 5 | 0 | 131353 |
| audio-warm-cache | 0 | 0 | 0 |
| audio-retry-one-clip | 2 | 0 | 32839 |
| source-episode-two-reads | 1 | 0 | 32768 |

Byte ceilings allow modest metadata headroom and live in
[usage-budgets.json](../fixtures/performance/usage-budgets.json). Request ceilings
preserve existing batching/cache behavior. Actual account quotas and reset dates
have not been checked; account forecasting and warning thresholds remain unfinished.

Raw observations: [browser JSON](performance-baselines/2026-10-18-browser.json),
[usage JSON](performance-baselines/2026-10-18-usage.json). To reproduce or extend the
run, use [PERFORMANCE.md](PERFORMANCE.md). Timings remain report-only in CI.
