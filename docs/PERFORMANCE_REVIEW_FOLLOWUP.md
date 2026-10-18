# Review performance follow-up — 2026-10-18

Loading history only for the active card reduced large-library warm Review
median from **3891.4 to 902.6 ms** in Chromium (76.8%) and **7962 to 1943 ms**
in phone-emulated WebKit (75.6%). These are local synthetic measurements, not
production or physical-phone measurements.

## Change and correctness

Queue construction previously fetched all in-scope reading reviews twice:
once for meaning-choice rotation and once for missed readings. Those reads
also subscribed the scope query to review-history changes. Browser transaction
profiling identified repeated review-store scans as a major loading cost.

`getSentenceReviewHistory` now uses the existing compound study-item index and
review item index to read one sentence's evidence in a read-only transaction.
Review waits for that evidence before mounting the question and keeps it fixed
through the attempt. Advancing loads the next card's history; failed reads offer
Retry. Older duplicate study items retain their combined history, and a later
unflagged review clears a previous missed-reading prompt. There is no schema
migration, eligibility change or automatic rating.

## Comparison

Same fixture, screen-readiness assertions, host, production build process,
browser versions and container as the [original baseline](PERFORMANCE_BASELINE.md).
Source: `ccb6aa8` plus the active-card-history changes in this commit. Five
observations per cell, one worker, zero added latency. No other local test/build
jobs ran during these timings; background host services were not controlled.
All four Review cases passed, with 60 observations and no application errors
or external requests. The other screens were not remeasured in this follow-up.

Median milliseconds, **before → after**:

| Profile | Library | Document | Warm | Offline |
| --- | --- | ---: | ---: | ---: |
| Chromium desktop | Small | 994.5 → 945.1 | 326.1 → 142.0 | 330.4 → 127.7 |
| Chromium desktop | Large | 4269.2 → 1531.3 | 3891.4 → 902.6 | 3380.6 → 850.8 |
| WebKit phone emulation | Small | 1207 → 1189 | 875 → 321 | 864 → 370 |
| WebKit phone emulation | Large | 8656 → 2934 | 7962 → 1943 | 7451 → 2386 |

Small = 200 sentences / 1,000 reviews; large = 4,000 / 20,000. All sentence
cards are due; fixtures have no vocabulary links or audio. Setup is excluded.
Document starts a fresh JavaScript runtime with an existing local library;
warm/offline are primed in-app navigation. Timings include automation and two
animation frames. Five observations do not establish p95 or a stable CI limit.

[Raw follow-up observations](performance-baselines/2026-10-18-review-followup.json)
retain individual timings, browser versions and seed durations. Reproduce with
`npm run test:performance -- --grep 'library / Review'`, or append that grep
to the container command in [PERFORMANCE.md](PERFORMANCE.md).

## Validation and remaining work

- Focused repository, Review and audio-ladder tests: 95 passed, including
  delayed history, retries, choice rotation, missed readings and advancement.
- Full application coverage run: 2,750 passed, 14 conditional skips across
  five files; 70.71% statements and 72.11% lines.
- Typecheck, production build, lint (existing warnings, no errors) and
  whitespace checks passed.

Review still builds candidates and passage context for the whole scope; large
library cost is not constant. Timing thresholds, broader database/import
benchmarks and actual Supabase account-budget forecasting remain open in
[the roadmap](ROADMAP.md). The existing HTTP usage gates are unchanged.
