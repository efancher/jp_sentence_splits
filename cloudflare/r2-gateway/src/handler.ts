import type { Denial, OpResult, ReserveResult, UsageSnapshot } from './ledger';
import type { R2BucketLike } from './types';

/**
 * Request handling for the R2 gateway, kept free of Cloudflare runtime imports
 * so it is unit-tested with fakes (tests/r2Gateway.test.ts).
 *
 * Every object request must carry a Supabase access token. The gateway keeps
 * the same permissions as the Supabase `reference-audio` Storage policies:
 * the path owner may read, write and delete; readers of the path's book may
 * read. Object keys keep the existing `{ownerId}/{bookId}/{audioId}.{ext}` shape.
 */
export const MAX_OBJECT_BYTES = 50 * 1024 * 1024;

export const ALLOWED_MIME = new Set([
  'audio/ogg',
  'audio/opus',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/webm',
  'audio/wav',
]);

const KEY_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})\.(opus|mp3|wav|m4a)$/;

export interface LedgerPort {
  reserve(key: string, size: number): Promise<ReserveResult>;
  commit(id: string, key: string, size: number): Promise<void>;
  release(id: string): Promise<void>;
  remove(key: string): Promise<OpResult>;
  countOp(kind: 'A' | 'B'): Promise<OpResult>;
  seed(baselineBytes: number): Promise<void>;
  snapshot(): Promise<UsageSnapshot>;
}

export interface HandlerEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  ADMIN_TOKEN: string;
  ALLOWED_ORIGINS?: string;
  GATEWAY_DISABLED?: string;
}

export interface Deps {
  bucket: R2BucketLike;
  ledger: LedgerPort;
  /** Used for Supabase auth and permission lookups. */
  fetch: typeof fetch;
}

const DENIAL_STATUS: Record<Denial, number> = {
  not_seeded: 503,
  storage_limit: 507,
  class_a_limit: 429,
  class_b_limit: 429,
  bad_size: 400,
};

function corsHeaders(request: Request, env: HandlerEnv): Record<string, string> {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Type, Content-Length',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });
}

function deny(reason: Denial, extra: Record<string, string>): Response {
  return json({ error: reason }, DENIAL_STATUS[reason], extra);
}

function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Returns the Supabase user id for the bearer token, or null. */
async function authenticate(request: Request, env: HandlerEnv, deps: Deps): Promise<{ userId: string; token: string } | null> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  let res: Response;
  try {
    res = await deps.fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const user = (await res.json().catch(() => null)) as { id?: string } | null;
  return user?.id ? { userId: user.id.toLowerCase(), token } : null;
}

/** Same condition as the Storage SELECT policy, evaluated by the books RLS under the caller's token. */
async function canReadBook(bookId: string, token: string, env: HandlerEnv, deps: Deps): Promise<boolean> {
  try {
    const res = await deps.fetch(
      `${env.SUPABASE_URL}/rest/v1/books?id=eq.${encodeURIComponent(bookId)}&deleted_at=is.null&select=id`,
      { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return false;
    const rows = (await res.json().catch(() => [])) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

async function handleAdmin(request: Request, url: URL, env: HandlerEnv, deps: Deps, cors: Record<string, string>): Promise<Response> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!env.ADMIN_TOKEN || !constantTimeEqual(token, env.ADMIN_TOKEN)) return json({ error: 'unauthorized' }, 401, cors);
  if (url.pathname === '/v1/admin/usage' && request.method === 'GET') {
    return json(await deps.ledger.snapshot(), 200, cors);
  }
  if (url.pathname === '/v1/admin/seed' && request.method === 'POST') {
    const body = (await request.json().catch(() => null)) as { baselineBytes?: unknown } | null;
    const bytes = body?.baselineBytes;
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return json({ error: 'baselineBytes required' }, 400, cors);
    await deps.ledger.seed(bytes);
    return json(await deps.ledger.snapshot(), 200, cors);
  }
  return json({ error: 'not_found' }, 404, cors);
}

export async function handleRequest(request: Request, env: HandlerEnv, deps: Deps): Promise<Response> {
  const cors = corsHeaders(request, env);
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  if (url.pathname.startsWith('/v1/admin/')) return handleAdmin(request, url, env, deps, cors);

  if (env.GATEWAY_DISABLED === '1') return json({ error: 'gateway_disabled' }, 503, cors);

  const prefix = '/v1/objects/';
  if (!url.pathname.startsWith(prefix)) return json({ error: 'not_found' }, 404, cors);
  let key: string;
  try {
    key = decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    return json({ error: 'bad_key' }, 400, cors);
  }
  const match = KEY_PATTERN.exec(key);
  if (!match) return json({ error: 'bad_key' }, 400, cors);
  const [, pathOwner, bookId] = match as unknown as [string, string, string];

  const auth = await authenticate(request, env, deps);
  if (!auth) return json({ error: 'unauthorized' }, 401, cors);
  const isOwner = auth.userId === pathOwner;

  switch (request.method) {
    case 'GET':
    case 'HEAD': {
      if (!isOwner && !(await canReadBook(bookId, auth.token, env, deps))) return json({ error: 'forbidden' }, 403, cors);
      const op = await deps.ledger.countOp('B');
      if (!op.ok) return deny(op.reason, cors);
      if (request.method === 'HEAD') {
        const info = await deps.bucket.head(key);
        if (!info) return json({ error: 'not_found' }, 404, cors);
        return new Response(null, {
          status: 200,
          headers: { ...cors, 'Content-Type': info.httpMetadata?.contentType ?? 'application/octet-stream', 'Content-Length': String(info.size) },
        });
      }
      const object = await deps.bucket.get(key);
      if (!object) return json({ error: 'not_found' }, 404, cors);
      return new Response(object.body, {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
          'Content-Length': String(object.size),
          'Cache-Control': 'private, no-store',
        },
      });
    }
    case 'PUT': {
      if (!isOwner) return json({ error: 'forbidden' }, 403, cors);
      const contentType = (request.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!ALLOWED_MIME.has(contentType)) return json({ error: 'unsupported_type' }, 415, cors);
      const length = Number(request.headers.get('Content-Length'));
      if (!Number.isInteger(length) || length <= 0) return json({ error: 'length_required' }, 411, cors);
      if (length > MAX_OBJECT_BYTES) return json({ error: 'too_large' }, 413, cors);
      if (!request.body) return json({ error: 'empty_body' }, 400, cors);

      const reservation = await deps.ledger.reserve(key, length);
      if (!reservation.ok) return deny(reservation.reason, cors);
      let stored;
      try {
        stored = await deps.bucket.put(key, request.body, { httpMetadata: { contentType } });
      } catch {
        // A thrown put does not prove nothing was stored: keep the reservation
        // until it expires rather than freeing bytes that may exist.
        return json({ error: 'upload_failed' }, 502, cors);
      }
      if (stored.size !== length) {
        // Truncated body: remove the partial object so it cannot be served.
        await deps.bucket.delete(key).catch(() => undefined);
        await deps.ledger.release(reservation.id);
        return json({ error: 'length_mismatch' }, 400, cors);
      }
      await deps.ledger.commit(reservation.id, key, stored.size);
      return json({ key, size: stored.size, warning: reservation.warning || undefined }, 200, cors);
    }
    case 'DELETE': {
      if (!isOwner) return json({ error: 'forbidden' }, 403, cors);
      const op = await deps.ledger.remove(key);
      if (!op.ok) return deny(op.reason, cors);
      await deps.bucket.delete(key);
      return json({ key, deleted: true }, 200, cors);
    }
    default:
      return json({ error: 'method_not_allowed' }, 405, cors);
  }
}
