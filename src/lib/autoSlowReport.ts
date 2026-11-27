// Automatic slow-page reports. A page that sits on a "Loading…" placeholder for
// 30s+ (or hits the 60s give-up) files the same report as the banner's
// "Report slow page" button, so the problem reaches /issues without the learner
// having to notice, tap and wait. Rate-limited so one stuck page cannot flood
// the reports table.

import type { PageTiming } from './pageTiming';

/** Slow enough to be a fault rather than a busy moment (the banner starts at 5s). */
export const AUTO_REPORT_MS = 30_000;
const PER_PATH_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MAX_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'autoSlowReports:v1';

export interface AutoReportLog {
  /** ISO time of each report sent, newest last, with its path. */
  sent: Array<{ path: string; at: string }>;
}

export function shouldAutoReport(timing: PageTiming, log: AutoReportLog, now: Date = new Date()): boolean {
  if (!timing.timedOut && timing.ms < AUTO_REPORT_MS) return false;
  const nowMs = now.getTime();
  const recent = log.sent.filter((entry) => nowMs - new Date(entry.at).getTime() < DAY_MS);
  if (recent.length >= MAX_PER_DAY) return false;
  return !recent.some(
    (entry) => entry.path === timing.path && nowMs - new Date(entry.at).getTime() < PER_PATH_COOLDOWN_MS,
  );
}

export function loadAutoReportLog(): AutoReportLog {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as AutoReportLog) : null;
    return parsed && Array.isArray(parsed.sent) ? parsed : { sent: [] };
  } catch {
    return { sent: [] };
  }
}

export function saveAutoReportLog(log: AutoReportLog): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sent: log.sent.slice(-20) }));
  } catch {
    // Private mode/quota: worst case a report repeats after a reload.
  }
}

/** Timings already handled this session, keyed by `at`, so re-renders never re-report. */
const handled = new Set<string>();

/**
 * Report `timing` if it qualifies. Returns true when a report was filed. `file`
 * does the actual write (kept injectable so tests need no database).
 */
export async function maybeAutoReport(
  timing: PageTiming,
  file: (note: string) => Promise<void>,
  options: { visible?: boolean; now?: Date } = {},
): Promise<boolean> {
  if (handled.has(timing.at)) return false;
  handled.add(timing.at);
  // A backgrounded iOS page is suspended, so a long "load" there says nothing.
  if (options.visible === false) return false;
  const log = loadAutoReportLog();
  const now = options.now ?? new Date();
  if (!shouldAutoReport(timing, log, now)) return false;
  const seconds = Math.round(timing.ms / 1000);
  try {
    await file(`Auto-reported slow page: ${timing.path} took ${seconds}s${timing.timedOut ? '+ (still loading)' : ''}`);
  } catch {
    return false;
  }
  saveAutoReportLog({ sent: [...log.sent, { path: timing.path, at: now.toISOString() }] });
  return true;
}

export function wasAutoReported(timing: PageTiming): boolean {
  return loadAutoReportLog().sent.some((entry) => entry.path === timing.path && entry.at >= timing.at);
}

/** Test hook. */
export function resetAutoReportState(): void {
  handled.clear();
}
