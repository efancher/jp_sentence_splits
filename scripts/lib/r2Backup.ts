import { classify, type ClipRow } from './r2Migration';

/**
 * Additive local mirror of live reference-audio clips held in R2 (see
 * docs/CLOUDFLARE_R2_PLAN.md). Dependencies are injected so the rules are
 * tested without live services.
 *
 * Safety rules: the backup is never pruned (a clip deleted or lost upstream
 * stays in the mirror); an existing local file is only replaced when its size
 * disagrees with the database row; files are written under a temporary name and
 * renamed once the size is verified; a gateway refusal (auth, rate limit) stops
 * the run instead of retrying into a limit.
 */

export type BackupOutcome =
  | 'downloaded'
  | 'would_download'
  | 'already_backed_up'
  | 'redownloaded'
  | 'missing_in_r2'
  | 'failed_download'
  | 'failed_size_mismatch'
  | 'failed_write'
  | 'skipped_no_path'
  | 'skipped_bad_path'
  | 'skipped_foreign_owner'
  | 'skipped_mime'
  | 'aborted';

export type FetchResult =
  | { status: 'ok'; bytes: Uint8Array }
  | { status: 'absent' }
  | { status: 'refused'; code: number }
  | { status: 'error' };

export interface BackupDeps {
  /** Size of the local mirror file, or null when it does not exist. */
  localSize(key: string): Promise<number | null>;
  /** Reads an object from the gateway. */
  fetchObject(key: string): Promise<FetchResult>;
  /** Writes atomically (temporary file, then rename). */
  writeLocal(key: string, bytes: Uint8Array): Promise<void>;
}

export interface BackupOptions {
  ownerId: string;
  apply: boolean;
  concurrency: number;
}

export interface BackupReport {
  items: Array<{ id: string; outcome: BackupOutcome }>;
  counts: Partial<Record<BackupOutcome, number>>;
  bytesDownloaded: number;
  bytesToDownload: number;
  abortedReason?: string;
}

export async function backupClips(
  rows: ClipRow[],
  deps: BackupDeps,
  options: BackupOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<BackupReport> {
  const results = new Map<string, BackupOutcome>();
  let bytesDownloaded = 0;
  let bytesToDownload = 0;
  let abortedReason: string | undefined;
  let done = 0;
  let next = 0;

  const finish = (id: string, outcome: BackupOutcome) => {
    results.set(id, outcome);
    done += 1;
    onProgress?.(done, rows.length);
  };

  async function processRow(row: ClipRow): Promise<void> {
    const plan = classify(row, options.ownerId);
    if (typeof plan === 'string') {
      return finish(row.id, plan as Extract<BackupOutcome, `skipped_${string}`>);
    }

    const local = await deps.localSize(plan.key);
    const sizeAgrees = local !== null && (row.sizeBytes === null || local === row.sizeBytes);
    if (sizeAgrees) return finish(row.id, 'already_backed_up');

    if (!options.apply) {
      bytesToDownload += row.sizeBytes ?? 0;
      return finish(row.id, 'would_download');
    }

    const fetched = await deps.fetchObject(plan.key);
    if (fetched.status === 'refused') {
      abortedReason = `gateway refused a read (${fetched.code})`;
      return finish(row.id, 'aborted');
    }
    if (fetched.status === 'absent') return finish(row.id, 'missing_in_r2');
    if (fetched.status === 'error') return finish(row.id, 'failed_download');
    const { bytes } = fetched;
    if (row.sizeBytes !== null && bytes.length !== row.sizeBytes) return finish(row.id, 'failed_size_mismatch');

    try {
      await deps.writeLocal(plan.key, bytes);
    } catch {
      return finish(row.id, 'failed_write');
    }
    bytesDownloaded += bytes.length;
    return finish(row.id, local === null ? 'downloaded' : 'redownloaded');
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
        finish(row.id, 'failed_download');
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));

  const items = rows.map((row) => ({ id: row.id, outcome: results.get(row.id) ?? ('aborted' as BackupOutcome) }));
  const counts: Partial<Record<BackupOutcome, number>> = {};
  for (const item of items) counts[item.outcome] = (counts[item.outcome] ?? 0) + 1;
  return { items, counts, bytesDownloaded, bytesToDownload, abortedReason };
}
