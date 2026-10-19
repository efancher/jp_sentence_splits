/**
 * Active-time stopwatch for a single card. Time while the page is inactive
 * (hidden tab, locked phone, or another window focused) is excluded, so the result approximates
 * time the learner could actually have spent on the card. Recorded as
 * `Review.elapsedMs`: effort evidence only, never a grade or a speed target.
 */
export interface ActiveTimer {
  /** Restart for a new card. */
  reset(now?: number): void;
  /** Mark the page inactive/active; repeated calls with the same state are ignored. */
  setActive(active: boolean, now?: number): void;
  /** Active milliseconds since the last reset. */
  elapsed(now?: number): number;
}

export function createActiveTimer(startActive = true, now = Date.now()): ActiveTimer {
  let startedAt = now;
  let hiddenSince: number | null = startActive ? null : now;
  let hiddenMs = 0;
  return {
    reset(at = Date.now()) {
      startedAt = at;
      hiddenMs = 0;
      if (hiddenSince !== null) hiddenSince = at;
    },
    setActive(active, at = Date.now()) {
      if (active && hiddenSince !== null) {
        hiddenMs += at - hiddenSince;
        hiddenSince = null;
      } else if (!active && hiddenSince === null) {
        hiddenSince = at;
      }
    },
    elapsed(at = Date.now()) {
      const hiddenNow = hiddenSince !== null ? at - hiddenSince : 0;
      return Math.max(0, Math.round(at - startedAt - hiddenMs - hiddenNow));
    },
  };
}

/** Visible tab in a focused window. */
export function pageIsActive(): boolean {
  return !document.hidden && document.hasFocus();
}
