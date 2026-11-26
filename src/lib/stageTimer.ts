/**
 * Wall-clock timings for a multi-step import, so a slow step can be found on a
 * phone with no console: marks go to `console.info` and the latest run is kept
 * in localStorage for the page to show.
 */
const STORAGE_KEY = 'quickmine.lastTimings';

export interface StageTimer {
  /** Record the time since the previous mark (or the start) under `label`. */
  mark(label: string): void;
  /** Persist the marks so far as the "last import" timings. */
  save(): void;
}

export function createStageTimer(name: string): StageTimer {
  let last = Date.now();
  const marks: [string, number][] = [];
  return {
    mark(label) {
      const now = Date.now();
      marks.push([label, now - last]);
      console.info(`[${name}] ${label}: ${((now - last) / 1000).toFixed(1)}s`);
      last = now;
    },
    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(marks));
      } catch {
        // Storage unavailable: timings are diagnostics only.
      }
    },
  };
}

export function readLastTimings(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return '';
    const marks = JSON.parse(raw) as [string, number][];
    return marks.map(([label, ms]) => `${label} ${(ms / 1000).toFixed(1)}s`).join(' · ');
  } catch {
    return '';
  }
}
