/**
 * Active-time stopwatch for a single card. Time while the page is hidden
 * (backgrounded tab, locked phone) is excluded, so the result approximates
 * time the learner could actually have spent on the card. Recorded as
 * `Review.elapsedMs`: effort evidence only, never a grade or a speed target.
 */
export interface ActiveTimer {
  /** Restart for a new card. */
  reset(now?: number): void;
  /** Mark the page hidden/visible; repeated calls with the same state are ignored. */
  setVisible(visible: boolean, now?: number): void;
  /** Active milliseconds since the last reset. */
  elapsed(now?: number): number;
}

export function createActiveTimer(startVisible = true, now = Date.now()): ActiveTimer {
  let startedAt = now;
  let hiddenSince: number | null = startVisible ? null : now;
  let hiddenMs = 0;
  return {
    reset(at = Date.now()) {
      startedAt = at;
      hiddenMs = 0;
      if (hiddenSince !== null) hiddenSince = at;
    },
    setVisible(visible, at = Date.now()) {
      if (visible && hiddenSince !== null) {
        hiddenMs += at - hiddenSince;
        hiddenSince = null;
      } else if (!visible && hiddenSince === null) {
        hiddenSince = at;
      }
    },
    elapsed(at = Date.now()) {
      const hiddenNow = hiddenSince !== null ? at - hiddenSince : 0;
      return Math.max(0, Math.round(at - startedAt - hiddenMs - hiddenNow));
    },
  };
}
