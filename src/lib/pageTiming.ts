// Page load timing: how long each screen shows a "Loading…" placeholder after
// navigation, plus the longest main-thread stall in that window, so "this page
// took 25 seconds" can be told apart as slow IndexedDB (no stall) vs slow JS
// (big stall) vs sync contention (sync stage recorded). No per-page wiring.

export interface PageTiming {
  /** Pathname (no query/hash). */
  path: string;
  /** Navigation (or app launch, when `initial`) until no loading placeholder remained. */
  ms: number;
  /** Longest gap beyond the poll interval — JS hogging the thread. */
  maxStallMs: number;
  syncRunning: boolean;
  syncStage: string;
  initial: boolean;
  /** Gave up waiting; the page was still showing a placeholder. */
  timedOut: boolean;
  at: string;
}

export const SLOW_PAGE_MS = 5_000;
const GIVE_UP_MS = 60_000;
const POLL_MS = 100;
const MAX_KEPT = 30;
const STORAGE_KEY = 'pageTimings:v1';

const LOADING_TEXT = /^loading\b/i;

/** True while `root` still shows a leaf element reading "Loading…" (any suffix). */
export function hasLoadingPlaceholder(root: ParentNode): boolean {
  if (root.querySelector('.route-loading')) return true;
  for (const el of root.querySelectorAll('p, div, span, li')) {
    if (el.children.length > 0) continue;
    const text = el.textContent?.trim() ?? '';
    if (text.length <= 60 && LOADING_TEXT.test(text)) return true;
  }
  return false;
}

function loadStored(): PageTiming[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PageTiming[]).slice(-MAX_KEPT) : [];
  } catch {
    return [];
  }
}

let timings: PageTiming[] = loadStored();
const listeners = new Set<() => void>();

function record(timing: PageTiming): void {
  timings = [...timings, timing].slice(-MAX_KEPT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(timings));
  } catch {
    // Quota/private mode: in-memory history is enough.
  }
  for (const listener of listeners) listener();
}

export function getPageTimings(): PageTiming[] {
  return timings;
}

export function subscribePageTimings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Start timing a navigation. Returns a cancel function (call when the route
 * changes again or the shell unmounts). `startedAt` is a `performance.now()`
 * value; pass 0 for the initial load to include app boot.
 */
export function trackPageLoad(options: {
  path: string;
  root: ParentNode | null;
  initial: boolean;
  startedAt: number;
  syncState: () => { running: boolean; stage: string };
}): () => void {
  const { path, root, initial, startedAt, syncState } = options;
  if (!root) return () => undefined;
  let last = performance.now();
  let maxStall = 0;
  let clearStreak = 0;
  // Sync state as the page started loading is what matters, not after it settled.
  const startSync = syncState();
  const finish = (timedOut: boolean) => {
    window.clearInterval(timer);
    record({
      path,
      ms: Math.round(performance.now() - startedAt),
      maxStallMs: Math.round(maxStall),
      syncRunning: startSync.running,
      syncStage: startSync.stage,
      initial,
      timedOut,
      at: new Date().toISOString(),
    });
  };
  const timer = window.setInterval(() => {
    const now = performance.now();
    maxStall = Math.max(maxStall, now - last - POLL_MS);
    last = now;
    // Two clear polls in a row: lazy routes swap the Suspense fallback for the
    // page, which then shows its own placeholder a tick later.
    clearStreak = hasLoadingPlaceholder(root) ? 0 : clearStreak + 1;
    if (clearStreak >= 2) finish(false);
    else if (now - startedAt > GIVE_UP_MS) finish(true);
  }, POLL_MS);
  return () => window.clearInterval(timer);
}

/** Compact summary for report snapshots. */
export function summarizePageTimings(): PageTiming[] {
  return timings.slice(-10);
}

// --- Step timing inside slow loaders -----------------------------------------
// A page-level number says a page was slow; marks inside its data query say
// which await was. Runs still in flight are reported too, so a load that hangs
// shows where it is stuck.

export interface StepRun {
  name: string;
  totalMs: number;
  steps: Record<string, number>;
  at: string;
}

const STEP_RUN_MIN_MS = 300;
const MAX_STEP_RUNS = 15;
const finishedRuns: StepRun[] = [];
const inFlight = new Set<{ name: string; startedAt: number; steps: Record<string, number>; last: number }>();

export function stepTimer(name: string): { mark: (label: string) => void; done: () => void } {
  const startedAt = performance.now();
  const run = { name, startedAt, steps: {} as Record<string, number>, last: startedAt };
  inFlight.add(run);
  return {
    mark(label) {
      const now = performance.now();
      run.steps[label] = (run.steps[label] ?? 0) + Math.round(now - run.last);
      run.last = now;
    },
    done() {
      inFlight.delete(run);
      const totalMs = Math.round(performance.now() - startedAt);
      if (totalMs < STEP_RUN_MIN_MS) return;
      finishedRuns.push({ name, totalMs, steps: run.steps, at: new Date().toISOString() });
      if (finishedRuns.length > MAX_STEP_RUNS) finishedRuns.shift();
    },
  };
}

export function summarizeStepRuns(): { finished: StepRun[]; inFlight: unknown[] } {
  const now = performance.now();
  return {
    finished: [...finishedRuns],
    inFlight: [...inFlight]
      .filter((run) => now - run.startedAt >= STEP_RUN_MIN_MS)
      .map((run) => ({ name: run.name, runningMs: Math.round(now - run.startedAt), stepsSoFar: run.steps })),
  };
}
