# Living documentation

Apply root guidance. Paths below are relative to `docs/`.

- `STATUS.md` is a concise current snapshot, including unresolved limitations.
  Avoid restoring a chronological implementation log; git holds that history.
- `ROADMAP.md` holds unfinished work, open decisions and possible extensions.
  When pruning a mixed completed/future entry, retain every unfinished idea and
  its meaningful constraints. Deferred or deliberately unplanned ideas are not
  stale merely because they have no implementation date.
- `AI_OVERVIEW.md` explains present behavior by feature. `ARCHITECTURE.md`
  records current design and invariants. Update the relevant document when its
  facts change instead of copying the same history into all four files.
- `STATUS_ARCHIVE.md` is frozen historical context. Keep research/planning
  documents as proposals where appropriate; do not mark their ideas shipped
  without implementation evidence. The default sentence-led flow must be clear
  when describing older word/grammar-card behavior.
- Date inventories, coverage figures and operational findings. Separate source
  implementation, local validation and verified deployment. Link reproducible
  checks in `TESTING.md` instead of maintaining competing test-count summaries.
- Verify relative links and referenced commands after moves or pruning. Remove
  obsolete pointers to deleted status sections, while preserving the underlying
  unresolved work. Document-only edits need consistency/link checks and
  `git diff --check`, not another full application test run.

Agent instructions should stay concise and scoped. Shared project rules belong
in the root [AGENTS.md](../AGENTS.md); local workflow details belong near their
code. Keep `CLAUDE.md` using the shared guidance rather than a diverging copy.
