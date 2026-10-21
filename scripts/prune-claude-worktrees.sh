#!/usr/bin/env bash
# Removes stale Claude worktrees under .claude/worktrees and their merged branches.
#
# A worktree is removed only when ALL hold:
#   - it is on its own branch (not main, not detached) and git has not locked it;
#   - `git status` is empty (no modified or untracked files);
#   - the branch has no commits outside origin/main (squash-merged branches are
#     kept: they cannot be told apart from unmerged work);
#   - nothing inside it (node_modules excluded) changed in the last MIN_AGE_DAYS;
#   - it is not the directory this script was started from.
# The branch is then deleted with `git branch -d`, which also refuses unmerged work.
# Prints one line per removal; silent when there is nothing to do.
#
# Usage: scripts/prune-claude-worktrees.sh [--dry-run] [--days N]
set -euo pipefail

dry_run=0
min_age_days=3
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    --days) min_age_days="${2:?--days needs a number}"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

# Always operate from the main checkout, wherever the session started.
common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
main_root="$(dirname "$common_dir")"
cd "$main_root"
worktree_root="$main_root/.claude/worktrees"
start_dir="$(pwd -P)"

timeout 30 git fetch -q origin main 2>/dev/null || { echo "prune-worktrees: fetch failed, skipping" >&2; exit 0; }

removed=0
path=""
while IFS= read -r line; do
  case "$line" in
    "worktree "*) path="${line#worktree }"; branch=""; locked=0 ;;
    "branch "*) branch="${line#branch refs/heads/}" ;;
    locked*) locked=1 ;;
    "")
      [ -n "$path" ] || continue
      case "$path" in "$worktree_root"/*) ;; *) path=""; continue ;; esac
      current="$path"; path=""
      [ -n "$branch" ] && [ "$branch" != "main" ] && [ "$locked" = 0 ] || continue
      case "$start_dir" in "$current"|"$current"/*) continue ;; esac
      [ -z "$(git -C "$current" status --porcelain 2>/dev/null || echo x)" ] || continue
      [ "$(git rev-list --count "origin/main..$branch" 2>/dev/null || echo 1)" = 0 ] || continue
      [ -z "$(find "$current" -path '*/node_modules' -prune -o -mtime "-$min_age_days" -print -quit 2>/dev/null)" ] || continue
      if [ "$dry_run" = 1 ]; then
        echo "would remove $current ($branch)"
      else
        git worktree remove "$current" 2>/dev/null || continue
        git branch -d "$branch" >/dev/null 2>&1 || true
        echo "removed $current ($branch)"
      fi
      removed=$((removed + 1))
      ;;
  esac
done < <(git worktree list --porcelain; echo)

[ "$dry_run" = 0 ] && git worktree prune
exit 0
