# Sentence-first learning handoff

Updated: 2026-09-30. The user tried the preview and said “looks good.”
This is feedback on the first review-layout slice, not acceptance of the whole
learning redesign or authorization to merge/deploy to production.

## Start here

- Repository: `/home/ed/projects/jp_sentence_splits` (leave the main checkout alone).
- Active implementation worktree: `/home/ed/projects/jp_sentence_splits-chapter-review`.
- Branch: `feat/chapter-review`.
- Draft PR: <https://github.com/efancher/jp_sentence_splits/pull/1>.
- Implementation HEAD at this checkpoint: `26741b4` plus the docs commit that follows it (see `git log`).
- Read `CLAUDE.md`, `docs/STATUS.md`, `docs/ARCHITECTURE.md`,
  `docs/AI_OVERVIEW.md`, `docs/ROADMAP.md`, and especially
  `docs/SENTENCE_FIRST_LEARNING_PLAN.md`. Follow local worktree instructions;
  the implementation checkout is already isolated. Check for new changes before editing.
- The separate `plan/sentence-first-learning` branch/worktree contains the
  earlier plan; the implementation branch already includes and extends it.
  Continue from the implementation branch, not the older plan branch.

## User direction to preserve

The main learning flow should start with a passage and a guided, Cure Dolly
style structural explanation of a sentence. Vocabulary and grammar practice
come out of that sentence; they must not gate access to the initial lesson.
Return to sentences as their components become familiar. The destination is
expressing the same meaning naturally, including different Japanese, with
stages between understanding, acquisition and production. Independent reading
is not the final 100% milestone. Percentage weights remain proposals.

Take the whole imported chapter/episode into account when selecting teaching
priorities, potentially through an AI preparation pass. Import failure or
missing analysis must not block reading. Compare vocabulary/grammar across
real encounters and distinguish familiarity from transfer. Avoid tiny,
underdetermined clozes such as interchangeable discourse expressions; a larger
phrase is useful only if it actually makes the question fair.

Include shadowing and independent spoken production as distinct activities.
Keep **Can't speak** and audio adjustment readily available. Secondary controls
can go in accessible sheets/popovers. Prefer native-speaker reference audio.
**TTS was deliberately shut down: do not restart it or synthesize fallback audio.**
Use trustworthy usage/progress data to improve the app. Keep assisted practice,
independent retrieval, content defects and audio defects distinguishable.
The user explicitly asked us to verify repository/service claims.

## Implemented and checked

- Full source chapter/episode for vocabulary `reading_retrieval`, vocabulary
  `cloze`, and `grammar_recognition`.
- Target highlight/blank in the document, existing question/reveal/rating below,
  bounded scrolling and **Back to target**. No whole-chapter learning gate.
- Correct source membership/chapter selection, including unassigned sentences;
  sentence fallback if no source exists. Stale previous documents are withheld.
- Cloze masks known literal surface/lemma/linked forms throughout the chapter
  and titles. The document uses plain Japanese without ruby/gloss/audio leaks.
- **Review layout** switch: **Original · sentence** / **New · chapter**.
  Chapter is the initial default; the browser remembers the choice in
  `satori-glossbook:review-layout`. Switching preserves reveal state and uses
  one queue and grading path. It is not a second learning database or scheduler.
- Existing FSRS, eligibility and grading remain unchanged. No database migration
  or new learning-event schema. Other review types retain their current layouts.
- Text-only fictional demo: 12 sentences, three due vocabulary reviews and one
  grammar recognition review. Schema-validated backup, merged via existing UI.

Key files: `src/components/ReviewDocumentText.tsx`, `src/lib/reviewDocument.ts`,
`src/lib/readingContext.ts`, `src/db/repository.ts` (`getReviewDocument`),
`src/pages/ReviewPage.tsx`, `src/styles/global.css`,
`scripts/generate-review-demo.ts`, `tests/reviewDocument.test.tsx`,
`tests/reviewPage.test.tsx`, `e2e/review-document.spec.ts`.

Validation evidence, with scope:

- Initial slice: build and full Vitest suite, **2184 passed / 12 skipped**.
- Layout-switch follow-up: build and **80 relevant unit tests passed**;
  **4 Playwright cases passed** (Chromium/WebKit × phone/desktop), covering
  masking, scroll position, preference persistence, switching after reveal and
  one persisted review per grade. Do not claim the full suite was rerun afterward.
- Demo: manually scripted Playwright checks through the actual HTTPS URL in
  Chromium and WebKit: download, import, all four reviews, both layouts.
- Reproduced the offline-cache interception bug with an active service worker,
  then verified the separate-origin download/import/review flow in both engines.

## Preview access and maintenance

Tailscale must be connected:

- App: <https://codex-dev.tailfbd89c.ts.net:8443/>.
- Sample download/instructions: <https://codex-dev.tailfbd89c.ts.net:8444/review-demo.html>.
- Import via Settings → Import backup JSON → Merge into existing data.
- Open the **global Review page** (`/#/review`) for all four sample reviews.
  Existing book-scoped review queues omit grammar patterns.

The preview has separate browser storage from the user's usual app. Keep cloud
sync disconnected for isolated experiments. Do not copy production credentials
into the preview. No production deployment or merge has been performed.

The preview runs as the user systemd **transient** service
`chapter-review-preview.service`, serving this worktree's `dist` directory on
`127.0.0.1:4174` using Python's static HTTP server. Tailscale HTTPS 8443 and 8444
proxy to that port. This survives chat turns, but is not an installed boot-time
service; check/recreate it after a machine restart. Check with:

```bash
systemctl --user status chapter-review-preview --no-pager
tailscale serve status
```

If absent, the service was created with:

```bash
systemd-run --user --unit=chapter-review-preview \
  --description='Chapter review trial preview' --property=Restart=on-failure \
  /usr/bin/python3 -m http.server 4174 --bind 127.0.0.1 \
  --directory /home/ed/projects/jp_sentence_splits-chapter-review/dist
```

After building, regenerate sample assets because Vite clears `dist`:

```bash
npm run build
./node_modules/.bin/tsx scripts/generate-review-demo.ts \
  dist/review-demo.json https://codex-dev.tailfbd89c.ts.net:8443
```

To also offer the exported real episode (text only; needs `/tmp/real-chapter`,
which is never committed), run after the demo step:
`./node_modules/.bin/tsx scripts/generate-real-episode-backup.ts dist/real-episode.json https://codex-dev.tailfbd89c.ts.net:8443`
and open `https://codex-dev.tailfbd89c.ts.net:8444/real-episode.html`. `dist/real-episode.*` has since been deleted; regenerate it only if needed.

The app's offline navigation fallback intercepts standalone HTML on its own
origin. **Do not give the user the sample HTML on port 8443.** Port 8444 is the
separate download origin, with links back to the app on 8443. Test with an
already-installed service worker, not just fresh browser contexts. Builds may
require accepting the app's update prompt to replace a cached app version.

Browser tests: use the cached `mcr.microsoft.com/playwright:v1.61.1-jammy`
container; see `e2e/README.md`. Native browser binaries exist but host libraries
are missing. Do not install host packages to solve this. The automated suite
uses a separate localhost preview on **4173**, not the user preview on 4174.
The worktree's `node_modules` symlink points to the main checkout; Docker needs
both mounts documented in the README. Use fresh synthetic browser data.

## Phase 0 slice completed (2026-09-30, later)

`Review.presentation` evidence and a derived, read-only episode focus panel on
the Reader are implemented (see STATUS). Not done from Phase 0: persisted
preparation status (pending/partial/ready/failed/stale), the AI episode-analysis
round-trip and its span/ID validation, learner accept/edit/dismiss of
suggestions, target-quality decisions beyond the gloss-only heuristic, the
real-episode fixture set, and the backup-schema field gap noted in STATUS.
Next: the ungated guided passage walkthrough (Phase 1), then persisted
preparation records with the inspectable AI round-trip.

## Remaining-work checklist (updated 2026-09-30)

Done: chapter review layouts + switch; `Review.presentation` evidence;
derived episode focus panel on the Reader.

Phase 0 leftovers
- [x] Persisted preparation status (ready/partial/failed; stale derived; pending = absent), separate from study progress — chapter-scoped only
- [x] Inspectable AI episode-analysis round trip with ID/span validation and provenance (paste-back; tried by the user on a real episode 2026-09-30: worked after the curly-quote and unlisted-target fixes)
- [x] One combined "episode pack" prompt (focus targets + missing translations; ordered parts for long episodes) landed on after series import, replacing the need for the AI API for those jobs; per-chunk why-notes still need a saved analysis
- [x] Learner accept / note / dismiss of prepared targets (derived focus panel itself is not editable)
- [x] Chapterless books: on-demand real "Whole book" chapter (Reader button)
- [ ] Target-quality decisions beyond the gloss-only heuristic (larger-phrase / alternate task)
- [~] Real-episode fixture set: one real episode tried locally (Teppei #1461, `e2e/real-chapter.spec.ts`, data kept out of git); still need repeated-filler / bad-alignment / very long cases (a real external-AI reply has now worked once)
- [x] Re-test idempotent re-import of the same episode (unit test; not against a real episode)
- [x] Fix backup `reviewSchema` dropping existing optional Review fields

Phase 1 - guided sentence learning in the passage (in progress)
- [x] Ungated expandable sentence walkthrough in the Reader (structure, literal/natural gloss) — heuristic/saved chunks, generic role text; no AI explanations yet
- [x] Can't speak + Adjust audio reachable in the walkthrough (inline, not yet a sheet)
- [x] Surface episode focus more prominently (always-visible line + per-sentence marker)
- [ ] Move secondary controls into an accessible sheet
- [x] Docker Playwright check for the Reader walkthrough (Chromium + WebKit)
- [x] Show the stage journey without claiming unbuilt stages are assessed

Phase 2 - activities inside the sentence + learning events (first slice done)
- [x] Practise this (self-assessed, explanation hidden first) and Compare uses (two real occurrences) per target in the walkthrough
- [x] Local-only `sentenceLearningEvents` (Dexie v22); no Review/StudyItem/FSRS effect
- [x] Docker Playwright check (`e2e/sentence-lesson.spec.ts`, Chromium + WebKit)
- [ ] Decide on sync/backup/Supabase migration for the events
- [ ] Contextual target selection; promote practised target into durable tracking; content-defect reports

Phases 3-6 (not started): support fading + sentence progress; supported/independent expression and
shadowing; planner `sentence_learning`; transfer/compare uses. Also open:
per-chunk source spans, long-chapter virtualization, browser test for the Reader
focus panel, live re-check of speech/mining services before relying on them.
Constraints: no TTS, native audio preferred, no merge/deploy without approval.

## Checkpoint 2026-09-30 (end of session): where to pick up

State: everything is committed and pushed to the draft PR; working tree clean.
The user imported the real episode (Teppei #1461, text only) into the private
preview and successfully pasted a real external-AI reply after two fixes found
by that trial. They have NOT reviewed the walkthrough's Practise this / Compare
uses on their phone yet, and have not said whether the episode pack prompt felt
right beyond "that worked".

Housekeeping owed:
- `dist/real-episode.*` was removed from the preview (2026-09-30); delete
  `/tmp/real-chapter` when the investigation is finished. Never commit it.
- Production data defects (root causes and guards in STATUS 2026-09-30
  "Sentence-membership integrity"): dangling `book_sentences` rows/clips for
  deleted sentences, and #1461's shared sign-off ordered before the intro.
  Run `npm run check:sentence-integrity` to see them. Repairs need the
  user's explicit OK: `npm run repair:dangling-sentence-rows -- --apply`,
  and the #1461 order fix (chapter has no `sourceId`).

Suggested next slices (none confirmed by the user):
1. DONE 2026-09-30: user said Practise this / Compare uses "both seem good" and
   asked for vocabulary aids in Compare uses (glosses, audio, on-request
   translation; see STATUS). The walkthrough itself now shows the gloss list too. Possible follow-up:
   glosses for words with no `english` suggestion.
2. DONE 2026-09-30: user chose sync. `sentence_learning_events` mapper/engine/
   migration `20260930020000_sentence_learning_events.sql` written (append-only,
   no FKs). The migration is NOT applied; applying it (merge triggers the
   auto-apply) is the user's production decision. Until then pushes of these rows
   would fail against a table that doesn't exist, so do not enable cloud sync in
   a build from this branch against production.
3. Phase 1 leftover: move secondary controls into an accessible sheet. Verified
   2026-09-30: "Adjust" (local clip trim, `NativeAudioButton`) and "Can't speak"
   are already in the walkthrough; do NOT add `SentenceAudioAdjuster` (a
   network source re-cut used on Analyze) there. Only Reader header controls
   (Speed/Text) and the focus/pack panels are candidates; needs the user's view
   on what counts as secondary.
4. Phase 2 leftovers: contextual target selection, promoting a practised target
   into durable tracking, "Another answer works"/"Poor question" reports.
5. Saved chunk-level analysis so walkthrough roles are not generic.
6. Phases 3-6 per `docs/SENTENCE_FIRST_LEARNING_PLAN.md`.
Note: the derived (pre-preparation) focus strip favours generic verbs; consider
prompting for preparation sooner or ranking better.

## Remaining work and suggested continuation

Only the first review presentation slice is implemented. Guided sentence
lessons, episode preparation, new event collection, sentence progress,
cross-encounter comparison, integrated shadowing/production and planner changes
are still planned. Known-form masking does not detect every inflection or
semantic alternative. Very long chapters are not virtualized. Existing audio
alignment defects are not fixed by this work.

Recommended next step: take a bounded piece of **Phase 0 — preparation and
evidence contracts** from the plan. Inspect current import paths and existing
learning/assistance events first, then define the smallest episode-level
preparation and review-presentation evidence addition that reuses them. Record
which layout/support was used without duplicate grade writes. Keep initial
guided access independent of vocabulary readiness. Follow with the ungated
passage walkthrough in Phase 1. This is a suggested sequence, not a claim the
user selected every proposed schema or UX detail.

Speech/import investigation previously verified separate repos
`/home/ed/projects/shadowing-analysis-api` and `/home/ed/projects/shadowing`,
plus mining under `server/youtube-mining` in the main app repo. At that time,
analysis ran on 8002 and mining on 8003; verify live status again before relying
on it. The old shadowing web app was documented as retired, while some shared
dependencies remained. Consult the plan's service inventory. A leftover proxy
to 8001 is not authorization to restore TTS.

Continue autonomously within the agreed plan, test meaningful behavior, update
the docs and draft PR. Do not infer permission to merge/deploy to production
from the user's positive preview feedback.
