import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';

import { expect, test } from '@playwright/test';

import { libraryRows, RESTORE_SIZES } from '../../tests/helpers/librarySeed';

/**
 * Fresh-device restore in a real browser against the disposable Postgres harness
 * (docs/PERFORMANCE.md). A browser with an empty IndexedDB and a signed-in session
 * starts the app's own sync, and we time how long the data takes to arrive.
 *
 * The app is built with its Supabase URL pointed at a small proxy started here. The
 * proxy answers the one auth call, forwards REST calls to PostgREST (which serves at
 * the root, unlike Supabase) and measures request count, bytes and per-request time
 * on the server side of the browser. Session tokens are signed with the harness's
 * throwaway JWT secret. Timings are report-only observations, not limits.
 */
const POSTGREST = new URL(process.env.RESTORE_POSTGREST ?? 'http://127.0.0.1:54330');
const PROXY_PORT = Number(process.env.RESTORE_PROXY_PORT ?? 54331);
const USER = '11111111-1111-1111-1111-111111111111';
const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters';
const SIZE_NAME = process.env.RESTORE_SIZE ?? 'small';
/** Route the app sits on while it restores. The landing page runs live queries that re-run on every write. */
const ROUTE = process.env.RESTORE_ROUTE || '/';
const ROUTE_LABEL = ROUTE === '/' ? '' : `-${ROUTE.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}`;
const size = RESTORE_SIZES[SIZE_NAME]!;

const signJwt = (): string => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ role: 'authenticated', sub: USER, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 6 * 3600 });
  return `${head}.${body}.${createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
};

interface ProxyStats { requests: number; bytes: number; durations: number[]; firstAt?: number; pageStarts: number[] }

function startProxy(stats: ProxyStats): Promise<http.Server> {
  const user = { id: USER, aud: 'authenticated', role: 'authenticated', email: 'a@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': req.headers.origin ?? '*',
      'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Expose-Headers': '*',
      Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const url = new URL(req.url ?? '/', 'http://proxy');
    if (url.pathname === '/auth/v1/user') {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(user));
      return;
    }
    if (!url.pathname.startsWith('/rest/v1/')) { res.writeHead(404, cors); res.end('{}'); return; }
    const started = Date.now();
    stats.firstAt ??= started;
    if (url.pathname === '/rest/v1/sync_events') stats.pageStarts.push(started);
    const headers = { ...req.headers };
    delete headers.host; delete headers.origin; delete headers.referer;
    const upstream = http.request({
      host: POSTGREST.hostname, port: POSTGREST.port, method: req.method, headers,
      path: url.pathname.slice('/rest/v1'.length) + url.search,
    }, (up) => {
      res.writeHead(up.statusCode ?? 502, { ...up.headers, ...cors });
      up.on('data', (chunk: Buffer) => { stats.bytes += chunk.length; });
      up.on('end', () => { stats.requests += 1; stats.durations.push(Date.now() - started); });
      up.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502, cors); res.end('{}'); });
    req.pipe(upstream);
  });
  return new Promise((resolve) => server.listen(PROXY_PORT, '127.0.0.1', () => resolve(server)));
}

const STORES = ['books', 'sentences', 'bookSentences', 'studyItems', 'reviews', 'sentenceLearningEvents'] as const;

test('fresh device restores a study library through the real browser sync', async ({ page, context }, testInfo) => {
  const expected = [size.books, size.sentences, size.sentences, size.sentences, size.sentences * size.reviewsPerCard, size.sentences];
  const stats: ProxyStats = { requests: 0, bytes: 0, durations: [], pageStarts: [] };
  const proxy = await startProxy(stats);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  const consoleLines: string[] = [];
  page.on('response', (r) => { if (r.status() >= 400) consoleLines.push(`HTTP ${r.status()} ${r.url().slice(0, 160)}`); });
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consoleLines.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  const session = JSON.stringify({
    access_token: signJwt(), token_type: 'bearer', expires_in: 6 * 3600,
    expires_at: Math.floor(Date.now() / 1000) + 6 * 3600, refresh_token: 'unused',
    user: { id: USER, aud: 'authenticated', role: 'authenticated', email: 'a@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  });
  // supabase-js keys the session by the first label of the project hostname: "127" for 127.0.0.1.
  await context.addInitScript(([key, value]) => localStorage.setItem(key!, value!), ['sb-127-auth-token', session]);

  const counts = () => page.evaluate(async (stores) => {
    const dbs = await indexedDB.databases();
    if (!dbs.some((d) => d.name === 'satori-glossbook')) return null;
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const r = indexedDB.open('satori-glossbook');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    });
    if (!db) return null;
    try {
      if (!stores.every((s) => db.objectStoreNames.contains(s))) return null;
      const tx = db.transaction([...stores], 'readonly');
      return await Promise.all(stores.map((s) => new Promise<number>((resolve, reject) => {
        const r = tx.objectStore(s).count();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      })));
    } finally { db.close(); }
  }, [...STORES]);

  // Optional Chromium CPU profile of the whole restore (RESTORE_PROFILE=1), saved next to the results.
  const cdp = process.env.RESTORE_PROFILE === '1' && testInfo.project.name === 'chromium-desktop' ? await context.newCDPSession(page) : null;
  if (cdp) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 2000 });
    await cdp.send('Profiler.start');
  }
  const t0 = Date.now();
  await page.goto(ROUTE);
  const progress: Array<{ ms: number; reviews: number }> = [];
  let tDone = 0;
  let last: number[] | null = null;
  const deadline = t0 + Number(process.env.RESTORE_DEADLINE_MS ?? 800_000);
  while (Date.now() < deadline) {
    last = await counts().catch(() => null);
    if (last) {
      progress.push({ ms: Date.now() - t0, reviews: last[4]! });
      if (last.every((n, i) => n === expected[i])) { tDone = Date.now(); break; }
    }
    if (stats.requests === 0 && Date.now() - t0 > 90_000) {
      // Nothing reached the API after 90 s: fail fast with evidence instead of waiting out the deadline.
      await page.screenshot({ path: `test-results/performance/restore/${SIZE_NAME}-${testInfo.project.name}-stalled.png` }).catch(() => undefined);
      console.log(`STALLED no API request after 90s. url=${page.url()} console=${JSON.stringify(consoleLines.slice(0, 8))} errors=${JSON.stringify(errors)}`);
      break;
    }
    await page.waitForTimeout(250);
  }
  proxy.close();
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    mkdirSync('test-results/performance/restore', { recursive: true });
    writeFileSync(`test-results/performance/restore/${SIZE_NAME}${ROUTE_LABEL}-${testInfo.project.name}.cpuprofile`, JSON.stringify(profile));
  }

  const sorted = [...stats.durations].sort((a, b) => a - b);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const thin = progress.filter((_, i) => i % Math.max(1, Math.floor(progress.length / 40)) === 0);
  const completed = tDone > 0;
  const endAt = completed ? tDone : Date.now();
  const result = {
    project: testInfo.project.name, size: SIZE_NAME, route: ROUTE, rows: libraryRows(size), library: size,
    completed, finalCounts: last, expectedCounts: expected,
    totalMs: endAt - t0,
    syncMs: endAt - (stats.firstAt ?? t0),
    bootToFirstRequestMs: (stats.firstAt ?? t0) - t0,
    requests: stats.requests, responseBytes: stats.bytes,
    requestMs: { sum: sorted.reduce((a, b) => a + b, 0), median: sorted[sorted.length >> 1], p95: sorted[Math.floor(sorted.length * 0.95)],
      max: sorted[sorted.length - 1], first10avg: Math.round(avg(stats.durations.slice(0, 10))), last10avg: Math.round(avg(stats.durations.slice(-10))) },
    // Time between consecutive 100-event pages = the app's apply time for the previous page (plus its record fetches).
    pageGapsMs: stats.pageStarts.slice(1).map((t, i) => t - stats.pageStarts[i]!),
    pageErrors: errors, progress: thin,
    note: 'Observation, not a limit: localhost API with no network latency; no CPU throttling; desktop Chromium and emulated iPhone WebKit on this machine.',
  };
  mkdirSync('test-results/performance/restore', { recursive: true });
  writeFileSync(`test-results/performance/restore/${SIZE_NAME}${ROUTE_LABEL}-${testInfo.project.name}.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(`RESTORE ${completed ? '' : 'INCOMPLETE '}${SIZE_NAME} ${testInfo.project.name}: rows=${result.rows} total=${result.totalMs}ms sync=${result.syncMs}ms requests=${result.requests} bytes=${result.responseBytes} reqMs(first10/last10)=${result.requestMs.first10avg}/${result.requestMs.last10avg} errors=${errors.length}`);
  expect(completed, `restore did not complete; counts ${JSON.stringify(last)} of ${JSON.stringify(expected)}; page errors ${JSON.stringify(errors)}`).toBe(true);
});
