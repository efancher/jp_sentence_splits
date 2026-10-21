import { createHash } from 'node:crypto';

import type { ClipRow, HeadResult } from './r2Migration';
import { classify } from './r2Migration';

/**
 * Decides which Supabase Storage objects are safe to delete after the move to
 * R2 (docs/CLOUDFLARE_R2_PLAN.md). An object is eligible only when its row is
 * live, its key is valid for the signed-in owner, the Supabase object exists,
 * and R2 holds an object of the SAME size. Anything else is kept and reported.
 * Pure logic; the script supplies the listings and checks.
 */
export type CleanupDecision =
  | 'delete'
  | 'skip_invalid'
  | 'skip_no_supabase_object'
  | 'skip_not_in_r2'
  | 'skip_size_mismatch'
  | 'skip_row_size_mismatch'
  | 'skip_check_error';

export function decideCleanup(
  row: ClipRow,
  ownerId: string,
  supabaseSize: number | undefined,
  r2: HeadResult,
): CleanupDecision {
  const plan = classify(row, ownerId);
  if (typeof plan === 'string') return 'skip_invalid';
  if (supabaseSize === undefined) return 'skip_no_supabase_object';
  if (r2.status === 'error' || r2.status === 'refused') return 'skip_check_error';
  if (r2.status === 'absent') return 'skip_not_in_r2';
  if (r2.size !== supabaseSize) return 'skip_size_mismatch';
  if (row.sizeBytes !== null && row.sizeBytes !== supabaseSize) return 'skip_row_size_mismatch';
  return 'delete';
}

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Evenly spread sample of at most `n` items, deterministic for tests. */
export function spreadSample<T>(items: T[], n: number): T[] {
  if (n >= items.length) return [...items];
  if (n <= 0) return [];
  const step = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)]!);
}
