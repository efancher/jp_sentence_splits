/**
 * Harness for the real-Postgres sync tests (`npm run test:pg`).
 *
 * The push path is exercised against the project's actual migrations (tables,
 * unique indexes, RLS policies) served through PostgREST, so constraint and
 * policy behaviour is the real thing rather than a hand-written fake. Containers
 * are started by scripts/pg-test.sh; see tests/pgIntegration/README.md.
 */
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { createClient } from '@supabase/supabase-js';

export const PG_TESTS_ENABLED = Boolean(process.env.SYNC_PG_TEST);

const PG_CONTAINER = process.env.SYNC_PG_CONTAINER ?? 'rlspg';
const REST_URL = process.env.SYNC_PG_REST_URL ?? 'http://127.0.0.1:54330';
const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters';

export const USER_A = '11111111-1111-1111-1111-111111111111';
export const USER_B = '22222222-2222-2222-2222-222222222222';

/** Runs SQL as the superuser (bypasses RLS) and returns the rows as trimmed lines. */
export function sql(query: string): string[] {
  const out = execFileSync(
    'docker',
    ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'supabase_admin', '-h', 'localhost', '-d', 'postgres', '-tAq', '-v', 'ON_ERROR_STOP=1', '-c', `set client_min_messages = warning; ${query}`],
    { encoding: 'utf8' },
  );
  return out.split('\n').map((l) => l.trim()).filter((l) => l && l !== 'SET');
}

export function scalar(query: string): string {
  return sql(query)[0] ?? '';
}

export function resetDatabase(): void {
  sql(`do $$ declare t text; begin
    for t in select tablename from pg_tables where schemaname = 'public' loop
      execute format('truncate table public.%I restart identity cascade', t);
    end loop;
    delete from auth.users;
  end $$`);
  for (const [id, email] of [[USER_A, 'a@example.com'], [USER_B, 'b@example.com']]) {
    sql(`insert into auth.users (id, email) values ('${id}', '${email}')`);
  }
}

function signJwt(userId: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ role: 'authenticated', sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export interface PgClient {
  /** The stand-in for `getSupabase()` — real supabase-js query builder, faked auth. */
  client: unknown;
  /** Number of HTTP requests made so far. */
  requestCount: () => number;
}

/** A supabase-js client acting as `userId`, talking to PostgREST with a real JWT. */
export function pgClientFor(userId: string): PgClient {
  const token = signJwt(userId);
  let requests = 0;
  const real = createClient(`${REST_URL}/rest/v1`, 'anon-key-unused', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init = {}) => {
        requests += 1;
        if (process.env.SYNC_PG_DEBUG) console.log('[req]', init.method ?? 'GET', String(input instanceof Request ? input.url : input).slice(0, 120));
        // PostgREST serves at the root; supabase-js appends /rest/v1.
        const url = String(input instanceof Request ? input.url : input).replace('/rest/v1/rest/v1', '');
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${token}`);
        return fetch(url, { ...init, headers });
      },
    },
  });
  return {
    requestCount: () => requests,
    client: {
      from: (table: string) => real.from(table),
      auth: { getSession: async () => ({ data: { session: { user: { id: userId } } } }) },
    },
  };
}
