# Project instructions

Read these before making substantial changes:

- docs/ARCHITECTURE.md — architecture and design decisions
- docs/STATUS.md — current implementation state (snapshot; the frozen
  chronological detail lives in docs/STATUS_ARCHIVE.md — append new detail
  to STATUS.md, not the archive)
- docs/ROADMAP.md — planned work
- docs/AI_OVERVIEW.md — present-tense, feature-oriented reference meant to
  be pasted into another AI's context (not a changelog); keep it in sync
  when a feature area materially changes, same triggers as below

This checkout is shared by multiple concurrent Claude Code sessions (not
isolated worktrees per session) — broad, unscoped git writes from one
session can clobber another's in-progress work. Before making changes,
call `EnterWorktree` to move the session into an isolated git worktree.
When spawning a subagent via the `Agent` tool to write or edit code, pass
`isolation: "worktree"` so it works on its own copy too.

Before implementing:
1. Inspect the relevant existing code.
2. Do not rewrite working functionality unnecessarily.
3. Run relevant tests after changes.

After completing a significant feature:
1. Update STATUS.md.
2. Update ARCHITECTURE.md if architecture changed.
3. Update ROADMAP.md if milestones changed.
4. Commit logically related changes separately.

Current learning mode: the app runs the **sentence-led flow** by default
(`settings.sentenceLedFlow`, since 2026-10-02) — vocabulary and grammar cards are
not shown or seeded, so never gate new work on vocabulary-card history, word
proficiency or "words the learner studies". Use the sentence-level "introduced"
signal (`getIntroducedSentenceIds` / `filterToIntroducedSentenceIds`). See
docs/ARCHITECTURE.md "Learning mode" and the callout at the top of
docs/AI_OVERVIEW.md. Before writing a gate, check against real data (e.g.
`npm run db:query`) that it can still be satisfied by recently imported sentences.
