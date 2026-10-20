/**
 * R2 usage monitor logic (docs/CLOUDFLARE_R2_PLAN.md). Reads Cloudflare's
 * GraphQL Analytics API and reports storage and Class A/B operations against
 * the free allowances. Analytics are observational, not a billing meter or an
 * admission counter. Missing, stale, truncated or failed data is reported as
 * unknown, never as zero. Operation names follow
 * https://developers.cloudflare.com/r2/pricing/ (checked 2026-10-20).
 */
export const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
/** Cloudflare caps a query at 31 days and a page at 10,000 rows here. */
export const MAX_ROWS = 10_000;
export const STALE_STORAGE_HOURS = 48;

const CLASS_A = new Set([
  'ListBuckets', 'PutBucket', 'ListObjects', 'ListObjectsV2', 'PutObject', 'CopyObject', 'CompleteMultipartUpload',
  'CreateMultipartUpload', 'LifecycleStorageTierTransition', 'ListMultipartUploads', 'UploadPart',
  'UploadPartCopy', 'ListParts', 'PutBucketEncryption', 'PutBucketCors', 'PutBucketLifecycleConfiguration',
]);
const CLASS_B = new Set([
  'HeadBucket', 'HeadObject', 'GetObject', 'UsageSummary', 'GetBucketEncryption', 'GetBucketLocation',
  'GetBucketCors', 'GetBucketLifecycleConfiguration',
]);
const FREE = new Set(['DeleteObject', 'DeleteObjects', 'DeleteBucket', 'AbortMultipartUpload']);

export type OpClass = 'A' | 'B' | 'free' | 'unclassified';
export const classifyAction = (name: string): OpClass =>
  CLASS_A.has(name) ? 'A' : CLASS_B.has(name) ? 'B' : FREE.has(name) ? 'free' : 'unclassified';

export interface Allowances {
  /** Standard-tier free storage, bytes (GB-month, decimal). */
  storageBytes: number;
  classA: number;
  classB: number;
}
/** Free tier terms as published 2026-10-20; confirm before relying on them. */
export const DEFAULT_ALLOWANCES: Allowances = { storageBytes: 10_000_000_000, classA: 1_000_000, classB: 10_000_000 };
/** Same engineering thresholds as the gateway ledger (not Cloudflare limits). */
export const DEFAULT_THRESHOLDS = { storageWarn: 8_000_000_000, classAWarn: 500_000, classBWarn: 5_000_000 };

export interface OperationRow { actionType: string; bucketName?: string; requests: number }
export interface StorageRow { datetime: string; payloadSize: number; metadataSize: number; objectCount: number; uploadCount: number }

export interface Analytics {
  operations: OperationRow[];
  operationsTruncated: boolean;
  storage: StorageRow[];
  storageTruncated: boolean;
}

export type Status = 'ok' | 'warning' | 'exceeded' | 'unknown';

export interface Metric { name: string; used: number | null; allowance: number; status: Status; note?: string }
export interface R2Report {
  generatedAt: string;
  periodStart: string;
  bucket: string;
  metrics: Metric[];
  storage: { latestAt: string | null; payloadBytes: number | null; metadataBytes: number | null; objectCount: number | null; pendingMultipart: number | null; dailyPeakAverageBytes: number | null };
  unclassifiedOperations: Record<string, number>;
  bucketOperations: Record<string, { classA: number; classB: number }>;
  ledger?: { storageBytes: number; classA: number; classB: number; seeded: boolean };
  warnings: string[];
  status: Status;
}

function statusOf(used: number | null, warn: number, allowance: number): Status {
  if (used === null) return 'unknown';
  if (used > allowance) return 'exceeded';
  return used > warn ? 'warning' : 'ok';
}

const worst = (statuses: Status[]): Status =>
  (['exceeded', 'unknown', 'warning', 'ok'] as const).find((s) => statuses.includes(s)) ?? 'ok';

export function buildReport(input: {
  analytics: Analytics;
  bucket: string;
  periodStart: string;
  now: Date;
  allowances?: Allowances;
  thresholds?: typeof DEFAULT_THRESHOLDS;
  ledger?: R2Report['ledger'];
}): R2Report {
  const allowances = input.allowances ?? DEFAULT_ALLOWANCES;
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const { analytics } = input;
  const warnings: string[] = [];

  let classA = 0;
  let classB = 0;
  const unclassified: Record<string, number> = {};
  const byBucket: R2Report['bucketOperations'] = {};
  for (const row of analytics.operations) {
    const cls = classifyAction(row.actionType);
    const bucket = row.bucketName ?? '(none)';
    byBucket[bucket] ??= { classA: 0, classB: 0 };
    if (cls === 'A') { classA += row.requests; byBucket[bucket].classA += row.requests; }
    else if (cls === 'B') { classB += row.requests; byBucket[bucket].classB += row.requests; }
    else if (cls === 'unclassified') unclassified[row.actionType] = (unclassified[row.actionType] ?? 0) + row.requests;
  }
  const opsUnknown = analytics.operationsTruncated;
  if (opsUnknown) warnings.push('Operations result hit the row limit; counts are incomplete and reported as unknown.');
  if (Object.keys(unclassified).length) warnings.push(`Unclassified operation names (not counted as A or B): ${Object.keys(unclassified).join(', ')}`);

  const sorted = [...analytics.storage].sort((a, b) => b.datetime.localeCompare(a.datetime));
  const latest = analytics.storageTruncated ? undefined : sorted[0];
  let stale = false;
  if (latest && input.now.getTime() - Date.parse(latest.datetime) > STALE_STORAGE_HOURS * 3_600_000) {
    stale = true;
    warnings.push(`Latest storage sample is older than ${STALE_STORAGE_HOURS} hours (${latest.datetime}).`);
  }
  if (analytics.storageTruncated) warnings.push('Storage result hit the row limit; reported as unknown.');
  if (!latest && !analytics.storageTruncated) warnings.push('No storage samples returned for the period.');

  // R2 bills storage on daily peaks averaged over the period, not the latest value.
  const dailyPeak = new Map<string, number>();
  for (const s of analytics.storage) {
    const day = s.datetime.slice(0, 10);
    dailyPeak.set(day, Math.max(dailyPeak.get(day) ?? 0, s.payloadSize + s.metadataSize));
  }
  const dailyPeakAverage = dailyPeak.size && !analytics.storageTruncated
    ? [...dailyPeak.values()].reduce((a, b) => a + b, 0) / dailyPeak.size
    : null;

  const storageUsed = latest && !stale ? latest.payloadSize + latest.metadataSize : null;
  const metrics: Metric[] = [
    { name: 'Storage (latest, payload + metadata)', used: storageUsed, allowance: allowances.storageBytes, status: statusOf(storageUsed, thresholds.storageWarn, allowances.storageBytes),
      note: 'Billing uses the average of daily peaks, shown separately.' },
    { name: 'Class A operations (month to date)', used: opsUnknown ? null : classA, allowance: allowances.classA, status: statusOf(opsUnknown ? null : classA, thresholds.classAWarn, allowances.classA) },
    { name: 'Class B operations (month to date)', used: opsUnknown ? null : classB, allowance: allowances.classB, status: statusOf(opsUnknown ? null : classB, thresholds.classBWarn, allowances.classB) },
  ];

  if (input.ledger) {
    if (storageUsed !== null && Math.abs(storageUsed - input.ledger.storageBytes) > Math.max(1_000_000, storageUsed * 0.05)) {
      warnings.push(`Gateway ledger storage (${input.ledger.storageBytes} bytes) differs from analytics (${storageUsed}); something may be writing outside the gateway, or analytics lag.`);
    }
  }

  return {
    generatedAt: input.now.toISOString(),
    periodStart: input.periodStart,
    bucket: input.bucket,
    metrics,
    storage: {
      latestAt: latest?.datetime ?? null,
      payloadBytes: latest?.payloadSize ?? null,
      metadataBytes: latest?.metadataSize ?? null,
      objectCount: latest?.objectCount ?? null,
      pendingMultipart: latest?.uploadCount ?? null,
      dailyPeakAverageBytes: dailyPeakAverage,
    },
    unclassifiedOperations: unclassified,
    bucketOperations: byBucket,
    ledger: input.ledger,
    warnings,
    status: worst(metrics.map((m) => m.status)),
  };
}

const OPS_QUERY = `query R2Ops($accountTag: string!, $start: Time, $end: Time) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    r2OperationsAdaptiveGroups(limit: ${MAX_ROWS}, filter: { datetime_geq: $start, datetime_leq: $end }) {
      sum { requests } dimensions { actionType bucketName }
    }
  } }
}`;

const STORAGE_QUERY = `query R2Storage($accountTag: string!, $start: Time, $end: Time, $bucket: string) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    r2StorageAdaptiveGroups(limit: ${MAX_ROWS}, filter: { datetime_geq: $start, datetime_leq: $end, bucketName: $bucket }, orderBy: [datetime_DESC]) {
      max { objectCount uploadCount payloadSize metadataSize } dimensions { datetime }
    }
  } }
}`;

type Gql = { data?: { viewer?: { accounts?: Array<Record<string, unknown>> } }; errors?: Array<{ message?: string }> };

async function gql(fetchFn: typeof fetch, token: string, query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetchFn(GRAPHQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Cloudflare analytics request failed (${res.status})`);
  const body = (await res.json()) as Gql;
  if (body.errors?.length) throw new Error(`Cloudflare analytics error: ${body.errors.map((e) => e.message ?? 'unknown').join('; ')}`);
  const account = body.data?.viewer?.accounts?.[0];
  if (!account) throw new Error('Cloudflare analytics returned no account (check the account id and token scope)');
  return account;
}

/** Splits [start, end] into windows of at most 31 days (the API's maximum range). */
export function windows(start: Date, end: Date): Array<[Date, Date]> {
  const out: Array<[Date, Date]> = [];
  const step = 30 * 86_400_000;
  for (let t = start.getTime(); t < end.getTime(); t += step) out.push([new Date(t), new Date(Math.min(t + step, end.getTime()))]);
  return out.length ? out : [[start, end]];
}

export async function fetchAnalytics(input: {
  fetch: typeof fetch;
  token: string;
  accountId: string;
  bucket: string;
  start: Date;
  end: Date;
}): Promise<Analytics> {
  const operations: OperationRow[] = [];
  const storage: StorageRow[] = [];
  let operationsTruncated = false;
  let storageTruncated = false;
  for (const [start, end] of windows(input.start, input.end)) {
    const variables = { accountTag: input.accountId, start: start.toISOString(), end: end.toISOString() };
    const ops = (await gql(input.fetch, input.token, OPS_QUERY, variables)).r2OperationsAdaptiveGroups as Array<{ sum: { requests: number }; dimensions: { actionType: string; bucketName?: string } }> | undefined;
    if (!ops) throw new Error('Operations dataset missing from response');
    if (ops.length >= MAX_ROWS) operationsTruncated = true;
    for (const r of ops) operations.push({ actionType: r.dimensions.actionType, bucketName: r.dimensions.bucketName, requests: r.sum.requests });

    const st = (await gql(input.fetch, input.token, STORAGE_QUERY, { ...variables, bucket: input.bucket })).r2StorageAdaptiveGroups as Array<{ max: { objectCount: number; uploadCount: number; payloadSize: number; metadataSize: number }; dimensions: { datetime: string } }> | undefined;
    if (!st) throw new Error('Storage dataset missing from response');
    if (st.length >= MAX_ROWS) storageTruncated = true;
    for (const r of st) storage.push({ datetime: r.dimensions.datetime, ...r.max });
  }
  return { operations, operationsTruncated, storage, storageTruncated };
}

export function toMarkdown(report: R2Report): string {
  const fmt = (n: number | null) => (n === null ? 'unknown' : n.toLocaleString('en-US'));
  const lines = [
    '# R2 usage report',
    '',
    `Status: **${report.status.toUpperCase()}**. Generated ${report.generatedAt}; period starts ${report.periodStart}; bucket \`${report.bucket}\`.`,
    'Analytics are observational (not a billing meter) and may lag. Allowances are the Standard free tier as published 2026-10-20; confirm them in the dashboard.',
    '',
    '| Metric | Used | Free allowance | Status |',
    '| --- | ---: | ---: | --- |',
    ...report.metrics.map((m) => `| ${m.name} | ${fmt(m.used)} | ${fmt(m.allowance)} | ${m.status} |`),
    '',
    `Storage: latest sample ${report.storage.latestAt ?? 'none'}; ${fmt(report.storage.objectCount)} objects; ${fmt(report.storage.pendingMultipart)} pending multipart uploads; average of daily peaks ${fmt(report.storage.dailyPeakAverageBytes === null ? null : Math.round(report.storage.dailyPeakAverageBytes))} bytes.`,
    '',
  ];
  if (report.ledger) lines.push(`Gateway ledger: ${fmt(report.ledger.storageBytes)} bytes, ${fmt(report.ledger.classA)} Class A, ${fmt(report.ledger.classB)} Class B, seeded: ${report.ledger.seeded}.`, '');
  if (report.warnings.length) lines.push('## Warnings', '', ...report.warnings.map((w) => `- ${w}`), '');
  return lines.join('\n');
}
