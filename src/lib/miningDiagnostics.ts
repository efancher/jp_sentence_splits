// Connection diagnostics for the mining service. Every request made through
// miningFetch is recorded in a small in-memory ring buffer, together with
// page lifecycle events (visibility, online/offline, bfcache restores). The
// import pages attach a snapshot to "Report issue" so a phone that can't reach
// the tailnet service can be diagnosed from the report alone: did requests
// fail instantly (DNS/connection refused), time out, or never get sent?
//
// This module must not import miningApi (miningApi imports it).

export type MiningRequestOutcome = 'ok' | 'http_error' | 'timeout' | 'network_error';

export interface MiningRequestLogEntry {
  at: string;
  method: string;
  /** Origin + path, without the query string. */
  url: string;
  ms: number;
  outcome: MiningRequestOutcome;
  status?: number;
  error?: string;
}

export interface MiningEventLogEntry {
  at: string;
  event: string;
}

const MAX_REQUESTS = 40;
const MAX_EVENTS = 30;
const requests: MiningRequestLogEntry[] = [];
const events: MiningEventLogEntry[] = [];
const loadedAt = new Date().toISOString();
let totals = { total: 0, ok: 0, failed: 0 };
let lastOkAt: string | null = null;
let lastFailureAt: string | null = null;
let consecutiveFailures = 0;

function push<T>(list: T[], item: T, max: number) {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

function stripQuery(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

export function recordMiningRequest(entry: MiningRequestLogEntry): void {
  push(requests, entry, MAX_REQUESTS);
  totals.total += 1;
  if (entry.outcome === 'ok' || entry.outcome === 'http_error') {
    // An HTTP error response still proves the service is reachable.
    totals.ok += 1;
    lastOkAt = entry.at;
    consecutiveFailures = 0;
  } else {
    totals.failed += 1;
    lastFailureAt = entry.at;
    consecutiveFailures += 1;
  }
}

export function recordMiningEvent(event: string): void {
  push(events, { at: new Date().toISOString(), event }, MAX_EVENTS);
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/** `fetch` that records the attempt (timing, outcome, error) in the diagnostics log. */
export async function miningFetch(url: string, init?: RequestInit): Promise<Response> {
  const started = performance.now();
  const at = new Date().toISOString();
  const method = (init?.method ?? 'GET').toUpperCase();
  try {
    const response = await (init ? fetch(url, init) : fetch(url));
    recordMiningRequest({
      at,
      method,
      url: stripQuery(url),
      ms: Math.round(performance.now() - started),
      outcome: response.ok ? 'ok' : 'http_error',
      status: response.status,
    });
    return response;
  } catch (err) {
    recordMiningRequest({
      at,
      method,
      url: stripQuery(url),
      ms: Math.round(performance.now() - started),
      outcome: init?.signal?.aborted ? 'timeout' : 'network_error',
      error: describeError(err),
    });
    throw err;
  }
}

function isStandalone(): boolean {
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/** Plain-JSON snapshot for a "Report issue" context provider. */
export function miningDiagnosticsSnapshot(): Record<string, unknown> {
  return {
    pageLoadedAt: loadedAt,
    online: typeof navigator !== 'undefined' ? navigator.onLine : null,
    visibility: typeof document !== 'undefined' ? document.visibilityState : null,
    standalonePwa: typeof window !== 'undefined' ? isStandalone() : null,
    serviceWorkerControlled:
      typeof navigator !== 'undefined' ? Boolean(navigator.serviceWorker?.controller) : null,
    totals: { ...totals },
    lastOkAt,
    lastFailureAt,
    consecutiveFailures,
    recentRequests: requests.slice(),
    recentEvents: events.slice(),
  };
}

/** Test-only: clear the buffers. */
export function resetMiningDiagnosticsForTests(): void {
  requests.length = 0;
  events.length = 0;
  totals = { total: 0, ok: 0, failed: 0 };
  lastOkAt = null;
  lastFailureAt = null;
  consecutiveFailures = 0;
}

let listenersInstalled = false;

/** Record page lifecycle events that commonly explain dropped requests on iOS. */
export function installMiningLifecycleListeners(): void {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;
  document.addEventListener('visibilitychange', () =>
    recordMiningEvent(`visibility:${document.visibilityState}`),
  );
  window.addEventListener('online', () => recordMiningEvent('online'));
  window.addEventListener('offline', () => recordMiningEvent('offline'));
  window.addEventListener('pageshow', (e) =>
    recordMiningEvent(e.persisted ? 'pageshow:bfcache' : 'pageshow'),
  );
  window.addEventListener('pagehide', () => recordMiningEvent('pagehide'));
}
