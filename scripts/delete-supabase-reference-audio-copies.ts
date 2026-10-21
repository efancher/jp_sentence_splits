/**
 * Deletes the signed-in user's reference-audio objects from SUPABASE Storage
 * once verified copies exist in R2. See docs/CLOUDFLARE_R2_PLAN.md.
 *
 * Dry run by default: lists what would be deleted and what is kept, and
 * hash-compares a sample of Supabase vs R2 objects. `--apply` deletes, in
 * batches, only objects whose live row is valid, whose Supabase object exists
 * and whose R2 twin has the identical size. It touches Supabase Storage only
 * (never R2, never database rows), leaves soft-deleted rows' files alone, and
 * stops before deleting if the hash sample finds any difference. Irreversible:
 * Supabase keeps no copy once removed.
 *
 * Usage:
 *   npx tsx scripts/delete-supabase-reference-audio-copies.ts [--apply]
 *     [--limit N] [--sample N] [--gateway URL]
 * The gateway URL defaults to R2_GATEWAY_URL or VITE_R2_GATEWAY_URL.
 * Writes test-results/r2-migration/delete-plan.json (paths and decisions only).
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import type { ClipRow, HeadResult } from './lib/r2Migration';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';
import { decideCleanup, sha256, spreadSample, type CleanupDecision } from './lib/supabaseCopyCleanup';

const BUCKET = 'reference-audio';
const BATCH = 100;

function numberFlag(argv: string[], name: string, fallback: number): number {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} needs a non-negative integer`);
  return n;
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const limit = argv.includes('--limit') ? numberFlag(argv, '--limit', 0) : undefined;
  const sampleSize = numberFlag(argv, '--sample', 30);
  const gatewayFlag = argv.indexOf('--gateway');
  const gateway = (gatewayFlag >= 0 ? argv[gatewayFlag + 1] : undefined)
    ?? process.env.R2_GATEWAY_URL ?? process.env.VITE_R2_GATEWAY_URL;
  if (!gateway) throw new Error('Set --gateway, R2_GATEWAY_URL or VITE_R2_GATEWAY_URL');
  const base = gateway.replace(/\/+$/, '');

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const authHeader = async (): Promise<Record<string, string>> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Session lost');
    return { Authorization: `Bearer ${session.access_token}` };
  };
  const objectUrl = (key: string) => `${base}/v1/objects/${key.split('/').map(encodeURIComponent).join('/')}`;

  const rows = await fetchAll<ClipRow>(supabase, 'reference_audio', 'id,storage_path,size_bytes,mime_type', user.id, (r) => ({
    id: String(r.id),
    storagePath: (r.storage_path as string | null) ?? null,
    sizeBytes: (r.size_bytes as number | null) ?? null,
    mimeType: (r.mime_type as string | null) ?? null,
  }));

  // Sizes of what Supabase Storage actually holds, per {owner}/{book} folder.
  const folders = new Set(rows.map((r) => r.storagePath?.split('/').slice(0, 2).join('/')).filter((f): f is string => Boolean(f)));
  const supabaseSizes = new Map<string, number>();
  for (const folder of folders) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 1000, offset });
      if (error) throw new Error(`list ${folder}: ${error.message}`);
      for (const object of data ?? []) {
        const size = (object.metadata as { size?: number } | null)?.size;
        if (typeof size === 'number') supabaseSizes.set(`${folder}/${object.name}`, size);
      }
      if (!data || data.length < 1000) break;
    }
  }
  console.log(`${rows.length} live rows; ${supabaseSizes.size} objects listed in Supabase Storage across ${folders.size} folders.`);

  const head = async (key: string): Promise<HeadResult> => {
    try {
      const res = await fetch(objectUrl(key), { method: 'HEAD', headers: await authHeader(), signal: AbortSignal.timeout(60_000) });
      if (res.status === 404) return { status: 'absent' };
      if (res.ok) return { status: 'present', size: Number(res.headers.get('Content-Length')) };
      if (res.status === 401 || res.status === 403 || res.status === 429) return { status: 'refused', code: res.status };
      return { status: 'error' };
    } catch {
      return { status: 'error' };
    }
  };

  const decisions = new Map<string, CleanupDecision>();
  const toDelete: Array<{ path: string; size: number }> = [];
  let next = 0;
  async function worker() {
    while (next < rows.length) {
      const row = rows[next++]!;
      const size = row.storagePath ? supabaseSizes.get(row.storagePath) : undefined;
      const r2 = row.storagePath && size !== undefined ? await head(row.storagePath) : ({ status: 'absent' } as HeadResult);
      const decision = decideCleanup(row, user.id, size, r2);
      decisions.set(row.id, decision);
      if (decision === 'delete') toDelete.push({ path: row.storagePath!, size: size! });
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));

  const counts: Record<string, number> = {};
  for (const d of decisions.values()) counts[d] = (counts[d] ?? 0) + 1;
  const totalBytes = toDelete.reduce((a, o) => a + o.size, 0);
  console.log('Decisions:', counts);
  console.log(`Eligible to delete from Supabase: ${toDelete.length} objects, ${(totalBytes / 1e6).toFixed(1)} MB.`);

  // Byte-for-byte check of a spread sample before anything is removed.
  const sample = spreadSample(toDelete, sampleSize);
  let mismatches = 0;
  for (const object of sample) {
    const [a, b] = await Promise.all([
      supabase.storage.from(BUCKET).download(object.path),
      fetch(objectUrl(object.path), { headers: await authHeader(), signal: AbortSignal.timeout(120_000) }),
    ]);
    if (!a.data || !b.ok || sha256(new Uint8Array(await a.data.arrayBuffer())) !== sha256(new Uint8Array(await b.arrayBuffer()))) {
      mismatches += 1;
      console.log(`  HASH MISMATCH or unreadable: ${object.path}`);
    }
  }
  console.log(`Hash sample: ${sample.length - mismatches}/${sample.length} identical.`);

  mkdirSync('test-results/r2-migration', { recursive: true });
  writeFileSync('test-results/r2-migration/delete-plan.json', JSON.stringify({
    apply, counts, eligible: toDelete.length, eligibleBytes: totalBytes,
    decisions: [...decisions.entries()].map(([id, decision]) => ({ id, decision })),
  }, null, 2) + '\n');

  if (!apply) {
    console.log('Dry run: nothing deleted. Re-run with --apply to delete the eligible objects from Supabase Storage.');
    return;
  }
  if (mismatches > 0) throw new Error('Hash sample found differences; refusing to delete anything.');

  const targets = limit === undefined ? toDelete : toDelete.slice(0, limit);
  let deleted = 0;
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH).map((o) => o.path);
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) throw new Error(`remove failed after ${deleted} objects: ${error.message}`);
    deleted += batch.length;
    console.log(`  deleted ${deleted}/${targets.length}`);
  }
  console.log(`Deleted ${deleted} objects from Supabase Storage. R2 and database rows untouched.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
