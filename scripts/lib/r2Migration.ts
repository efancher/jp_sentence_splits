import { createHash } from 'node:crypto';

/**
 * Copy planning/execution for moving reference-audio clips from Supabase
 * Storage to the R2 gateway (docs/CLOUDFLARE_R2_PLAN.md). Dependencies are
 * injected so the rules are tested without live services.
 *
 * Safety rules: Supabase copies are never touched; an R2 object that already
 * exists with a different size is reported, never overwritten (it may be a
 * newer upload made after the app flag was enabled); a gateway refusal
 * (auth, quota, rate) stops the run instead of retrying into a limit.
 */

const KEY_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})\.(opus|mp3|wav|m4a)$/;

export const ALLOWED_MIME = new Set([
  'audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/webm', 'audio/wav',
]);

export interface ClipRow {
  id: string;
  storagePath: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
}

export type HeadResult =
  | { status: 'present'; size: number }
  | { status: 'absent' }
  | { status: 'refused'; code: number }
  | { status: 'error' };

export type PutResult = { ok: true } | { ok: false; status: number; retryable: boolean };

export interface MigrationDeps {
  head(key: string): Promise<HeadResult>;
  /** Downloads from Supabase Storage; null when missing or failed. */
  download(storagePath: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array, mimeType: string): Promise<PutResult>;
  /** Reads an object back from the gateway for verification. */
  get(key: string): Promise<Uint8Array | null>;
}

export interface MigrationOptions {
  ownerId: string;
  apply: boolean;
  /** Maximum number of clips to copy this run; the rest are deferred. */
  limit?: number;
  concurrency: number;
  /** Compare a SHA-256 of the stored object to the source after copying. */
  readback: boolean;
  maxAttempts?: number;
}

export type Outcome =
  | 'copied'
  | 'would_copy'
  | 'already_present'
  | 'r2_differs'
  | 'deferred'
  | 'aborted'
  | 'skipped_no_path'
  | 'skipped_bad_path'
  | 'skipped_foreign_owner'
  | 'skipped_mime'
  | 'failed_head'
  | 'failed_download'
  | 'failed_size_mismatch'
  | 'failed_upload'
  | 'failed_verify';

export interface MigrationReport {
  items: Array<{ id: string; outcome: Outcome }>;
  counts: Partial<Record<Outcome, number>>;
  bytesCopied: number;
  bytesToCopy: number;
  /** Set when a gateway refusal stopped the run early. */
  abortedReason?: string;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Static checks that need no network. */
export function classify(row: ClipRow, ownerId: string): { key: string; mime: string } | Outcome {
  if (!row.storagePath) return 'skipped_no_path';
  const match = KEY_PATTERN.exec(row.storagePath);
  if (!match) return 'skipped_bad_path';
  if (match[1] !== ownerId.toLowerCase()) return 'skipped_foreign_owner';
  const mime = (row.mimeType ?? '').toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return 'skipped_mime';
  return { key: row.storagePath, mime };
}

export async function migrateClips(
  rows: ClipRow[],
  deps: MigrationDeps,
  options: MigrationOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<MigrationReport> {
  const maxAttempts = options.maxAttempts ?? 3;
  const results = new Map<string, Outcome>();
  let bytesCopied = 0;
  let bytesToCopy = 0;
  let abortedReason: string | undefined;
  let copiesStarted = 0;
  let done = 0;
  let next = 0;

  const finish = (id: string, outcome: Outcome) => {
    results.set(id, outcome);
    done += 1;
    onProgress?.(done, rows.length);
  };

  async function processRow(row: ClipRow): Promise<void> {
    const plan = classify(row, options.ownerId);
    if (typeof plan === 'string') return finish(row.id, plan);

    const head = await deps.head(plan.key);
    if (head.status === 'refused') {
      abortedReason = `gateway refused a check (${head.code})`;
      return finish(row.id, 'aborted');
    }
    if (head.status === 'error') return finish(row.id, 'failed_head');
    if (head.status === 'present') {
      if (row.sizeBytes === null || head.size === row.sizeBytes) return finish(row.id, 'already_present');
      return finish(row.id, 'r2_differs');
    }

    if (!options.apply) {
      bytesToCopy += row.sizeBytes ?? 0;
      return finish(row.id, 'would_copy');
    }
    if (options.limit !== undefined && copiesStarted >= options.limit) return finish(row.id, 'deferred');
    copiesStarted += 1;

    const bytes = await deps.download(plan.key);
    if (!bytes) return finish(row.id, 'failed_download');
    if (row.sizeBytes !== null && bytes.length !== row.sizeBytes) return finish(row.id, 'failed_size_mismatch');

    let uploaded = false;
    for (let attempt = 1; attempt <= maxAttempts && !uploaded; attempt += 1) {
      const put = await deps.put(plan.key, bytes, plan.mime);
      if (put.ok) {
        uploaded = true;
      } else if (!put.retryable) {
        if (put.status === 401 || put.status === 403 || put.status === 429 || put.status === 503 || put.status === 507) {
          abortedReason = `gateway refused an upload (${put.status})`;
        }
        return finish(row.id, abortedReason ? 'aborted' : 'failed_upload');
      }
    }
    if (!uploaded) return finish(row.id, 'failed_upload');

    const verify = await deps.head(plan.key);
    if (verify.status !== 'present' || verify.size !== bytes.length) return finish(row.id, 'failed_verify');
    if (options.readback) {
      const back = await deps.get(plan.key);
      if (!back || back.length !== bytes.length || sha256(back) !== sha256(bytes)) return finish(row.id, 'failed_verify');
    }
    bytesCopied += bytes.length;
    return finish(row.id, 'copied');
  }

  async function worker(): Promise<void> {
    while (next < rows.length) {
      const row = rows[next++]!;
      if (abortedReason) {
        finish(row.id, 'aborted');
        continue;
      }
      try {
        await processRow(row);
      } catch {
        finish(row.id, 'failed_upload');
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));

  const items = rows.map((row) => ({ id: row.id, outcome: results.get(row.id) ?? ('aborted' as Outcome) }));
  const counts: Partial<Record<Outcome, number>> = {};
  for (const item of items) counts[item.outcome] = (counts[item.outcome] ?? 0) + 1;
  return { items, counts, bytesCopied, bytesToCopy, abortedReason };
}
