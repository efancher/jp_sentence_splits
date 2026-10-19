import { describe, expect, it } from 'vitest';

import { handleRequest, MAX_OBJECT_BYTES, type Deps, type HandlerEnv, type LedgerPort } from '../cloudflare/r2-gateway/src/handler';
import { DEFAULT_LIMITS, monthOf, UsageLedger, type Limits } from '../cloudflare/r2-gateway/src/ledger';
import type { LedgerStorage, R2BucketLike } from '../cloudflare/r2-gateway/src/types';

const OWNER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const KEY = `${OWNER}/book_1/audio_1.m4a`;
const ORIGIN = 'https://app.example';

const env: HandlerEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  ADMIN_TOKEN: 'admin-secret',
  ALLOWED_ORIGINS: ORIGIN,
};

class FakeBucket implements R2BucketLike {
  objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  failPut = false;
  /** When set, `put` reports this size instead of the real one (simulates a truncated upload). */
  reportedSize: number | undefined;
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { size: o.bytes.length, httpMetadata: { contentType: o.contentType } } : null;
  }
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    return {
      size: o.bytes.length,
      httpMetadata: { contentType: o.contentType },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(o.bytes);
          controller.close();
        },
      }),
    };
  }
  async put(key: string, value: ReadableStream<Uint8Array> | ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) {
    if (this.failPut) throw new Error('r2 down');
    const bytes = new Uint8Array(value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer());
    this.objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType });
    return { size: this.reportedSize ?? bytes.length };
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

class MemoryStorage implements LedgerStorage {
  data = new Map<string, unknown>();
  async get<T>(key: string) {
    return this.data.get(key) as T | undefined;
  }
  async put(key: string, value: unknown) {
    this.data.set(key, structuredClone(value));
  }
}

async function makeLedger(limits: Limits = DEFAULT_LIMITS, now: () => number = Date.now, seed: number | null = 0) {
  const ledger = new UsageLedger(new MemoryStorage(), limits, now);
  await ledger.load();
  if (seed !== null) await ledger.seed(seed);
  return ledger;
}

function port(ledger: UsageLedger): LedgerPort {
  return {
    reserve: (k, s) => ledger.reserve(k, s),
    commit: (id, k, s) => ledger.commit(id, k, s),
    release: (id) => ledger.release(id),
    remove: (k) => ledger.remove(k),
    countOp: (kind) => ledger.countOp(kind),
    seed: (b) => ledger.seed(b),
    snapshot: async () => ledger.snapshot(),
  };
}

/** Fake Supabase: token `t-<uuid>` authenticates as that user; `members` lists readable books per user. */
function fakeSupabase(members: Record<string, string[]> = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const auth = new Headers(init?.headers).get('Authorization') ?? '';
    const user = auth.startsWith('Bearer t-') ? auth.slice('Bearer t-'.length) : null;
    if (!user) return new Response('{}', { status: 401 });
    if (url.pathname === '/auth/v1/user') return Response.json({ id: user });
    if (url.pathname === '/rest/v1/books') {
      const bookId = (url.searchParams.get('id') ?? '').replace('eq.', '');
      return Response.json((members[user] ?? []).includes(bookId) ? [{ id: bookId }] : []);
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}

async function setup(opts: { limits?: Limits; members?: Record<string, string[]>; seed?: number | null; now?: () => number } = {}) {
  const bucket = new FakeBucket();
  const ledger = await makeLedger(opts.limits, opts.now, opts.seed === undefined ? 0 : opts.seed);
  const deps: Deps = { bucket, ledger: port(ledger), fetch: fakeSupabase(opts.members) };
  const call = (method: string, key: string, user: string | null, init: { body?: string; type?: string; length?: number | null; origin?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (user) headers.Authorization = `Bearer t-${user}`;
    if (init.type) headers['Content-Type'] = init.type;
    const length = init.length === undefined ? init.body?.length : (init.length ?? undefined);
    if (length !== undefined) headers['Content-Length'] = String(length);
    if (init.origin) headers.Origin = init.origin;
    return handleRequest(new Request(`https://gw.example/v1/objects/${key}`, { method, headers, body: init.body }), env, deps);
  };
  return { bucket, ledger, deps, call };
}

describe('R2 gateway access rules', () => {
  it('requires a valid Supabase session', async () => {
    const { call } = await setup();
    expect((await call('GET', KEY, null)).status).toBe(401);
    expect((await call('PUT', KEY, null, { body: 'x', type: 'audio/mp4' })).status).toBe(401);
  });

  it('rejects keys outside the {owner}/{book}/{id}.{ext} shape, including traversal', async () => {
    const { call } = await setup();
    for (const key of ['nope', `${OWNER}/book_1/../x.m4a`, `${OWNER}/book_1/a.exe`, `${OWNER}/book_1/a/b.m4a`, "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA/b/a.m4a"]) {
      expect((await call('GET', key, OWNER)).status, key).toBe(400);
    }
  });

  it('lets the owner store and read back a clip with its content type', async () => {
    const { call, bucket } = await setup();
    const put = await call('PUT', KEY, OWNER, { body: 'hello-audio', type: 'audio/mp4' });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ key: KEY, size: 11 });
    expect(bucket.objects.get(KEY)?.contentType).toBe('audio/mp4');
    const get = await call('GET', KEY, OWNER);
    expect(get.status).toBe(200);
    expect(get.headers.get('Content-Type')).toBe('audio/mp4');
    expect(await get.text()).toBe('hello-audio');
    expect((await call('HEAD', KEY, OWNER)).headers.get('Content-Length')).toBe('11');
    expect((await call('GET', `${OWNER}/book_1/missing.m4a`, OWNER)).status).toBe(404);
  });

  it('allows book readers to read but not write or delete, and denies strangers', async () => {
    const { call } = await setup({ members: { [OTHER]: ['book_1'] } });
    await call('PUT', KEY, OWNER, { body: 'clip', type: 'audio/mp4' });
    expect(await (await call('GET', KEY, OTHER)).text()).toBe('clip');
    expect((await call('PUT', KEY, OTHER, { body: 'evil', type: 'audio/mp4' })).status).toBe(403);
    expect((await call('DELETE', KEY, OTHER)).status).toBe(403);
    const stranger = '33333333-3333-3333-3333-333333333333';
    expect((await call('GET', KEY, stranger)).status).toBe(403);
  });

  it('validates type and declared length before reserving anything', async () => {
    const { call, ledger } = await setup();
    expect((await call('PUT', KEY, OWNER, { body: 'x', type: 'text/html' })).status).toBe(415);
    expect((await call('PUT', KEY, OWNER, { body: 'x', type: 'audio/mp4', length: null })).status).toBe(411);
    expect((await call('PUT', KEY, OWNER, { body: 'x', type: 'audio/mp4', length: MAX_OBJECT_BYTES + 1 })).status).toBe(413);
    expect(ledger.snapshot().classA).toBe(0);
  });

  it('deletes only for the owner and removes the object', async () => {
    const { call, bucket } = await setup();
    await call('PUT', KEY, OWNER, { body: 'clip', type: 'audio/mp4' });
    expect((await call('DELETE', KEY, OWNER)).status).toBe(200);
    expect(bucket.objects.has(KEY)).toBe(false);
  });

  it('answers CORS preflight only for allowed origins', async () => {
    const { call } = await setup();
    const ok = await handleRequest(new Request('https://gw.example/v1/objects/x', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env, (await setup()).deps);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const bad = await call('GET', KEY, OWNER, { origin: 'https://evil.example' });
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('refuses everything but admin routes when the emergency switch is on', async () => {
    const { deps } = await setup();
    const off = { ...env, GATEWAY_DISABLED: '1' };
    const res = await handleRequest(new Request(`https://gw.example/v1/objects/${KEY}`, { headers: { Authorization: `Bearer t-${OWNER}` } }), off, deps);
    expect(res.status).toBe(503);
    const admin = await handleRequest(new Request('https://gw.example/v1/admin/usage', { headers: { Authorization: 'Bearer admin-secret' } }), off, deps);
    expect(admin.status).toBe(200);
  });
});

describe('R2 gateway admission control', () => {
  const small: Limits = { ...DEFAULT_LIMITS, storageWarnBytes: 80, storageStopBytes: 100 };

  it('refuses uploads until the ledger has been seeded', async () => {
    const { call, bucket } = await setup({ seed: null });
    const res = await call('PUT', KEY, OWNER, { body: 'clip', type: 'audio/mp4' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not_seeded' });
    expect(bucket.objects.size).toBe(0);
  });

  it('counts the seeded baseline and stops at the ceiling', async () => {
    const { call } = await setup({ limits: small, seed: 90 });
    const res = await call('PUT', KEY, OWNER, { body: 'x'.repeat(11), type: 'audio/mp4' });
    expect(res.status).toBe(507);
    expect((await call('PUT', KEY, OWNER, { body: 'x'.repeat(10), type: 'audio/mp4' })).status).toBe(200);
  });

  it('reserves atomically so concurrent uploads cannot jointly exceed the ceiling', async () => {
    const { call, bucket } = await setup({ limits: small, seed: 0 });
    const keys = Array.from({ length: 5 }, (_, i) => `${OWNER}/book_1/clip_${i}.m4a`);
    const results = await Promise.all(keys.map((k) => call('PUT', k, OWNER, { body: 'x'.repeat(30), type: 'audio/mp4' })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status === 507)).toHaveLength(2);
    expect(bucket.objects.size).toBe(3);
  });

  it('counts an overwrite by its growth, not its full size', async () => {
    const { call, ledger } = await setup({ limits: small, seed: 60 });
    await call('PUT', KEY, OWNER, { body: 'x'.repeat(30), type: 'audio/mp4' });
    expect(ledger.snapshot().storageBytes).toBe(90);
    // 30 -> 40 grows by 10 only, so it fits under 100.
    expect((await call('PUT', KEY, OWNER, { body: 'x'.repeat(40), type: 'audio/mp4' })).status).toBe(200);
    expect(ledger.snapshot().storageBytes).toBe(100);
    expect((await call('PUT', KEY, OWNER, { body: 'x'.repeat(41), type: 'audio/mp4' })).status).toBe(507);
  });

  it('removes a truncated object and frees its reservation', async () => {
    const { call, bucket, ledger } = await setup({ limits: small });
    bucket.reportedSize = 3;
    const res = await call('PUT', KEY, OWNER, { body: 'x'.repeat(30), type: 'audio/mp4' });
    expect(res.status).toBe(400);
    expect(bucket.objects.has(KEY)).toBe(false);
    expect(ledger.snapshot().reservedBytes).toBe(0);
  });

  it('keeps the reservation when R2 throws, because bytes may have been stored', async () => {
    const { call, bucket, ledger } = await setup({ limits: small });
    bucket.failPut = true;
    expect((await call('PUT', KEY, OWNER, { body: 'x'.repeat(30), type: 'audio/mp4' })).status).toBe(502);
    expect(ledger.snapshot().reservedBytes).toBe(30);
  });

  it('reclaims an abandoned reservation only after it expires', async () => {
    let now = Date.UTC(2026, 9, 19);
    const { call, bucket, ledger } = await setup({ limits: small, now: () => now });
    bucket.failPut = true;
    await call('PUT', KEY, OWNER, { body: 'x'.repeat(90), type: 'audio/mp4' });
    bucket.failPut = false;
    expect((await call('PUT', `${OWNER}/book_1/b.m4a`, OWNER, { body: 'x'.repeat(30), type: 'audio/mp4' })).status).toBe(507);
    now += 31 * 60 * 1000;
    expect((await call('PUT', `${OWNER}/book_1/b.m4a`, OWNER, { body: 'x'.repeat(30), type: 'audio/mp4' })).status).toBe(200);
    expect(ledger.snapshot().reservedBytes).toBe(0);
  });

  it('stops reads at the monthly Class B ceiling and writes at the Class A ceiling', async () => {
    const limits: Limits = { ...DEFAULT_LIMITS, classAStop: 2, classBStop: 2 };
    const { call } = await setup({ limits });
    expect((await call('PUT', KEY, OWNER, { body: 'clip', type: 'audio/mp4' })).status).toBe(200); // A=1
    expect((await call('GET', KEY, OWNER)).status).toBe(200); // B=1
    expect((await call('GET', KEY, OWNER)).status).toBe(200); // B=2
    const blocked = await call('GET', KEY, OWNER);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'class_b_limit' });
    expect((await call('PUT', `${OWNER}/book_1/b.m4a`, OWNER, { body: 'clip', type: 'audio/mp4' })).status).toBe(200); // A=2
    expect((await call('PUT', `${OWNER}/book_1/c.m4a`, OWNER, { body: 'clip', type: 'audio/mp4' })).status).toBe(429);
  });

  it('resets operation counts at a new month but keeps stored bytes', async () => {
    let now = Date.UTC(2026, 9, 31, 12);
    const limits: Limits = { ...DEFAULT_LIMITS, classAStop: 1 };
    const ledger = await makeLedger(limits, () => now, 50);
    expect((await ledger.reserve(KEY, 10)).ok).toBe(true);
    await ledger.commit('1', KEY, 10);
    expect(await ledger.reserve(`${OWNER}/book_1/b.m4a`, 10)).toEqual({ ok: false, reason: 'class_a_limit' });
    now = Date.UTC(2026, 10, 1, 1);
    expect(monthOf(now)).toBe('2026-11');
    expect((await ledger.reserve(`${OWNER}/book_1/b.m4a`, 10)).ok).toBe(true);
    expect(ledger.snapshot().storageBytes).toBe(60);
  });

  it('survives a restart: state persists in storage', async () => {
    const storage = new MemoryStorage();
    const a = new UsageLedger(storage, DEFAULT_LIMITS);
    await a.load();
    await a.seed(5);
    const r = await a.reserve(KEY, 7);
    expect(r.ok).toBe(true);
    if (r.ok) await a.commit(r.id, KEY, 7);
    const b = new UsageLedger(storage, DEFAULT_LIMITS);
    await b.load();
    expect(b.snapshot()).toMatchObject({ seeded: true, storageBytes: 12, objectCount: 1 });
  });

  it('warns above the warning threshold without refusing', async () => {
    const { call } = await setup({ limits: small, seed: 79 });
    const res = await call('PUT', KEY, OWNER, { body: 'xx', type: 'audio/mp4' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ warning: true });
  });
});

describe('R2 gateway admin routes', () => {
  it('rejects a missing or wrong admin token and accepts the right one', async () => {
    const { deps } = await setup({ seed: null });
    const call = (path: string, token: string | null, init: RequestInit = {}) =>
      handleRequest(new Request(`https://gw.example${path}`, { ...init, headers: token ? { Authorization: `Bearer ${token}` } : {} }), env, deps);
    expect((await call('/v1/admin/usage', null)).status).toBe(401);
    expect((await call('/v1/admin/usage', 't-' + OWNER)).status).toBe(401);
    const seeded = await call('/v1/admin/seed', 'admin-secret', { method: 'POST', body: JSON.stringify({ baselineBytes: 1234 }) });
    expect(seeded.status).toBe(200);
    expect(await seeded.json()).toMatchObject({ seeded: true, storageBytes: 1234 });
    expect((await call('/v1/admin/seed', 'admin-secret', { method: 'POST', body: '{}' })).status).toBe(400);
  });
});
