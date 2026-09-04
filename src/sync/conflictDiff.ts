/**
 * Presentation helpers for the conflict panel: normalise the local (domain,
 * camelCase) and remote (raw Postgres row, snake_case) payloads into a
 * comparable shape, then produce a unified line diff so a real difference
 * stands out instead of every line reading as "changed".
 */

function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Recursively lower-cases snake_case object keys to camelCase and sorts keys so
 * both sides serialise in the same order. Array order is preserved.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[toCamel(key)] = canonicalize((value as Record<string, unknown>)[key]);
    }
    // Re-sort: camel-casing can reorder relative to the raw sort above.
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(out).sort()) sorted[key] = out[key];
    return sorted;
  }
  return value;
}

export function prettyLines(value: unknown): string[] {
  try {
    return JSON.stringify(canonicalize(value), null, 2).split('\n');
  } catch {
    return [String(value)];
  }
}

/**
 * Sync-bookkeeping columns present on every remote row (see any
 * `supabase/migrations/*.sql` table) but never on the local domain
 * payload — `owner_id`, `version`, `deleted_at`, `client_id`,
 * `last_modified_by`. Diffing local vs. remote without stripping these
 * made every conflict's diff show them as spurious "added" lines
 * regardless of whether the learner's actual edit differed, burying the
 * real change under always-present noise (reported 2026-09-04 — "mostly
 * just bookkeeping entries, ids, versions, timestamps").
 */
const SYNC_BOOKKEEPING_KEYS = new Set([
  'ownerId',
  'version',
  'deletedAt',
  'clientId',
  'lastModifiedBy',
]);

/**
 * `canonicalize` plus dropping top-level sync-bookkeeping keys — only for
 * the diff view. The full local/remote JSON `<details>` panels in
 * ConflictPanel still show everything via plain `prettyLines`, unstripped,
 * since a real version/owner mismatch is exactly what debugging a conflict
 * sometimes needs to see.
 */
export function forDiff(value: unknown): unknown {
  const canonical = canonicalize(value);
  if (!canonical || typeof canonical !== 'object' || Array.isArray(canonical)) {
    return canonical;
  }
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(canonical as Record<string, unknown>)) {
    if (!SYNC_BOOKKEEPING_KEYS.has(key)) out[key] = v;
  }
  return out;
}

export type DiffRow = {
  type: 'context' | 'add' | 'remove';
  text: string;
};

/** Guard: skip the O(n·m) LCS table for pathologically large payloads. */
const MAX_DIFF_LINES = 4000;

/** Unified line diff (LCS backtrace). `a` = local, `b` = remote. */
export function diffLines(a: string[], b: string[]): DiffRow[] {
  const n = a.length;
  const m = b.length;
  if (n + m > MAX_DIFF_LINES) {
    return [
      ...a.map((text): DiffRow => ({ type: 'remove', text })),
      ...b.map((text): DiffRow => ({ type: 'add', text })),
    ];
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'context', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'remove', text: a[i] });
      i++;
    } else {
      rows.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) rows.push({ type: 'remove', text: a[i++] });
  while (j < m) rows.push({ type: 'add', text: b[j++] });
  return rows;
}

export function countChanges(rows: DiffRow[]): number {
  return rows.reduce((sum, row) => (row.type === 'context' ? sum : sum + 1), 0);
}
