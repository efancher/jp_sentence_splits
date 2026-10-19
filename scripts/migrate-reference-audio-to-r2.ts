/**
 * Copies the signed-in user's live reference-audio clips from Supabase Storage
 * to the R2 gateway. See docs/CLOUDFLARE_R2_PLAN.md.
 *
 * Dry run by default: checks what already exists in R2 and reports what would
 * be copied, with no uploads. `--apply` copies, verifying each object (size,
 * and a SHA-256 read-back unless `--no-readback`). Idempotent and resumable:
 * objects already present are skipped, and an R2 object with a different size
 * is reported and left alone. Supabase copies are never modified or deleted, and
 * soft-deleted rows are not migrated. A gateway refusal (auth, quota, rate
 * limit) stops the run.
 *
 * Usage:
 *   npx tsx scripts/migrate-reference-audio-to-r2.ts [--apply] [--limit N]
 *     [--concurrency N] [--no-readback] [--gateway URL]
 * The gateway URL defaults to R2_GATEWAY_URL or VITE_R2_GATEWAY_URL.
 * Writes a per-clip report (ids and outcomes only) to
 * test-results/r2-migration/report.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { migrateClips, type ClipRow, type MigrationDeps } from './lib/r2Migration';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const BUCKET = 'reference-audio';
const REQUEST_TIMEOUT_MS = 120_000;

function numberFlag(argv: string[], name: string, fallback: number): number {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} needs a positive integer`);
  return n;
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const readback = !argv.includes('--no-readback');
  const limit = argv.includes('--limit') ? numberFlag(argv, '--limit', 1) : undefined;
  const concurrency = numberFlag(argv, '--concurrency', 3);
  const gatewayFlag = argv.indexOf('--gateway');
  const gateway = (gatewayFlag >= 0 ? argv[gatewayFlag + 1] : undefined)
    ?? process.env.R2_GATEWAY_URL ?? process.env.VITE_R2_GATEWAY_URL;
  if (!gateway) throw new Error('Set --gateway, R2_GATEWAY_URL or VITE_R2_GATEWAY_URL');
  const base = gateway.replace(/\/+$/, '');

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const rows = await fetchAll<ClipRow>(
    supabase,
    'reference_audio',
    'id,storage_path,size_bytes,mime_type',
    user.id,
    (r) => ({
      id: String(r.id),
      storagePath: (r.storage_path as string | null) ?? null,
      sizeBytes: (r.size_bytes as number | null) ?? null,
      mimeType: (r.mime_type as string | null) ?? null,
    }),
  );
  console.log(`${rows.length} live clips for the signed-in user. Mode: ${apply ? 'APPLY' : 'dry run'}${limit ? `, limit ${limit}` : ''}.`);

  // Fetched per request so a long run survives access-token refresh.
  const authHeader = async (): Promise<Record<string, string>> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Session lost');
    return { Authorization: `Bearer ${session.access_token}` };
  };
  const objectUrl = (key: string) => `${base}/v1/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
  const timed = (init: RequestInit): RequestInit => ({ ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

  const deps: MigrationDeps = {
    async head(key) {
      try {
        const res = await fetch(objectUrl(key), timed({ method: 'HEAD', headers: await authHeader() }));
        if (res.status === 404) return { status: 'absent' };
        if (res.ok) return { status: 'present', size: Number(res.headers.get('Content-Length')) };
        if (res.status === 401 || res.status === 403 || res.status === 429) return { status: 'refused', code: res.status };
        return { status: 'error' };
      } catch {
        return { status: 'error' };
      }
    },
    async download(storagePath) {
      const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
      return error || !data ? null : new Uint8Array(await data.arrayBuffer());
    },
    async put(key, bytes, mimeType) {
      try {
        const res = await fetch(objectUrl(key), timed({
          method: 'PUT',
          headers: { ...(await authHeader()), 'Content-Type': mimeType },
          body: bytes as BodyInit,
        }));
        if (res.ok) return { ok: true };
        return { ok: false, status: res.status, retryable: res.status >= 500 && res.status !== 503 && res.status !== 507 };
      } catch {
        return { ok: false, status: 0, retryable: true };
      }
    },
    async get(key) {
      try {
        const res = await fetch(objectUrl(key), timed({ headers: await authHeader() }));
        return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
      } catch {
        return null;
      }
    },
  };

  let lastShown = 0;
  const report = await migrateClips(rows, deps, { ownerId: user.id, apply, limit, concurrency, readback }, (done, total) => {
    if (done - lastShown >= 100 || done === total) {
      lastShown = done;
      console.log(`  ${done}/${total}`);
    }
  });

  mkdirSync('test-results/r2-migration', { recursive: true });
  writeFileSync('test-results/r2-migration/report.json', JSON.stringify({ apply, gateway: base, ...report }, null, 2) + '\n');
  console.log('Outcomes:', report.counts);
  const mb = (n: number) => (n / 1e6).toFixed(1);
  console.log(apply ? `Copied ${mb(report.bytesCopied)} MB.` : `Would copy ${mb(report.bytesToCopy)} MB.`);
  if (report.abortedReason) console.log(`STOPPED EARLY: ${report.abortedReason}`);
  console.log('Report: test-results/r2-migration/report.json (Supabase copies untouched).');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
