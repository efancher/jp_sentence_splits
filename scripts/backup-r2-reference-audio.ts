/**
 * Mirrors the signed-in user's live reference-audio clips from the R2 gateway
 * to a local directory, so R2 is not the only copy. See
 * docs/CLOUDFLARE_R2_PLAN.md.
 *
 * Dry run by default: reports what is not yet mirrored, with no downloads.
 * `--apply` downloads missing clips, checking each against the database size and
 * writing atomically. Additive and resumable: existing files of the right size
 * are skipped and nothing is ever deleted from the mirror, so a clip removed or
 * lost in R2 stays recoverable. A gateway refusal (auth, rate limit) stops the
 * run. The mirror keeps R2 key paths (`<owner>/<book>/<clip>.<ext>`).
 *
 * Usage:
 *   npx tsx scripts/backup-r2-reference-audio.ts [--apply] [--concurrency N]
 *     [--dir PATH] [--gateway URL]
 * The directory defaults to R2_BACKUP_DIR or ~/backups/r2-reference-audio; the
 * gateway URL to R2_GATEWAY_URL or VITE_R2_GATEWAY_URL. Writes a per-clip report
 * (ids and outcomes only) to test-results/r2-backup/report.json.
 */
import { mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { backupClips, type BackupDeps } from './lib/r2Backup';
import type { ClipRow } from './lib/r2Migration';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const REQUEST_TIMEOUT_MS = 120_000;

function stringFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const value = argv[i + 1];
  if (!value) throw new Error(`${name} needs a value`);
  return value;
}

function concurrencyFlag(argv: string[]): number {
  const raw = stringFlag(argv, '--concurrency');
  if (raw === undefined) return 3;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error('--concurrency needs a positive integer');
  return n;
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const concurrency = concurrencyFlag(argv);
  const dir = stringFlag(argv, '--dir') ?? process.env.R2_BACKUP_DIR ?? join(homedir(), 'backups', 'r2-reference-audio');
  const gateway = stringFlag(argv, '--gateway') ?? process.env.R2_GATEWAY_URL ?? process.env.VITE_R2_GATEWAY_URL;
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
  console.log(`${rows.length} live clips. Mirror: ${dir}. Mode: ${apply ? 'APPLY' : 'dry run'}.`);

  // Fetched per request so a long run survives access-token refresh.
  const authHeader = async (): Promise<Record<string, string>> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Session lost');
    return { Authorization: `Bearer ${session.access_token}` };
  };
  const objectUrl = (key: string) => `${base}/v1/objects/${key.split('/').map(encodeURIComponent).join('/')}`;

  // Keys are validated by classify() before use, so joining them is path-safe.
  const deps: BackupDeps = {
    async localSize(key) {
      try {
        return statSync(join(dir, key)).size;
      } catch {
        return null;
      }
    },
    async fetchObject(key) {
      try {
        const res = await fetch(objectUrl(key), { headers: await authHeader(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        if (res.status === 404) return { status: 'absent' };
        if (res.status === 401 || res.status === 403 || res.status === 429) return { status: 'refused', code: res.status };
        if (!res.ok) return { status: 'error' };
        return { status: 'ok', bytes: new Uint8Array(await res.arrayBuffer()) };
      } catch {
        return { status: 'error' };
      }
    },
    async writeLocal(key, bytes) {
      const target = join(dir, key);
      mkdirSync(dirname(target), { recursive: true });
      const temp = `${target}.part`;
      writeFileSync(temp, bytes);
      renameSync(temp, target);
    },
  };

  let lastShown = 0;
  const report = await backupClips(rows, deps, { ownerId: user.id, apply, concurrency }, (done, total) => {
    if (done - lastShown >= 100 || done === total) {
      lastShown = done;
      console.log(`  ${done}/${total}`);
    }
  });

  mkdirSync('test-results/r2-backup', { recursive: true });
  writeFileSync('test-results/r2-backup/report.json', JSON.stringify({ apply, gateway: base, dir, ...report }, null, 2) + '\n');
  console.log('Outcomes:', report.counts);
  const mb = (n: number) => (n / 1e6).toFixed(1);
  console.log(apply ? `Downloaded ${mb(report.bytesDownloaded)} MB.` : `Would download ${mb(report.bytesToDownload)} MB.`);
  if (report.abortedReason) console.log(`STOPPED EARLY: ${report.abortedReason}`);
  const failed = Object.entries(report.counts).filter(([k]) => k.startsWith('failed_') || k === 'aborted' || k === 'missing_in_r2');
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
