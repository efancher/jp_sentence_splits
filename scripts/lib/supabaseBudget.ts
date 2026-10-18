import { z } from 'zod';

const amount = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER);
const optionalAmount = amount.nullable();
const timestamp = z.iso.datetime({ offset: true }).nullable();
const base = { used: optionalAmount, allowance: optionalAmount };
const growth = { growthPerDay: optionalAmount };

// Bytes are decimal bytes, counts are invocations. For storage/disk, `used`
// is the billing-period average in bytes, not the live size or GB-hours.
const metricSchema = z.discriminatedUnion('resource', [
  z.object({
    ...base,
    resource: z.enum(['uncached_egress', 'cached_egress', 'edge_function_invocations']),
    dailyUsage: optionalAmount,
    additionalUsage: amount,
  }).strict(),
  z.object({ ...base, ...growth, resource: z.literal('storage_size'), currentSize: optionalAmount }).strict(),
  z.object({ ...base, ...growth, resource: z.literal('database_size'), project: z.string().trim().min(1) }).strict(),
  z.object({ ...base, ...growth, resource: z.literal('disk_size'), project: z.string().trim().min(1), currentSize: optionalAmount }).strict(),
]);

export const budgetSnapshotSchema = z.object({
  version: z.literal(1),
  source: z.enum(['dashboard', 'example']),
  organization: z.string().trim().min(1),
  plan: z.string().trim().min(1).nullable(),
  // Organization totals must include other apps/projects sharing its allowance.
  allProjectsIncluded: z.boolean().nullable(),
  periodStart: timestamp,
  periodEnd: timestamp,
  capturedAt: timestamp,
  usageThrough: timestamp,
  headroomPercent: z.number().min(0).lt(100),
  maxAgeHours: z.number().positive().max(744),
  minimumElapsedHours: z.number().positive().max(744),
  metrics: z.array(metricSchema).min(1),
}).strict().superRefine((value, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  const start = value.periodStart && Date.parse(value.periodStart);
  const end = value.periodEnd && Date.parse(value.periodEnd);
  const through = value.usageThrough && Date.parse(value.usageThrough);
  if (typeof start === 'number' && typeof end === 'number' && end <= start) issue('periodEnd', 'Must be after periodStart.');
  if (typeof through === 'number' && typeof start === 'number' && through < start) issue('usageThrough', 'Must be within the stated billing period.');
  if (typeof through === 'number' && typeof end === 'number' && through > end) issue('usageThrough', 'Must be within the stated billing period.');
  if (typeof through === 'number' && value.capturedAt && through > Date.parse(value.capturedAt)) issue('usageThrough', 'Cannot be after capturedAt.');
  const keys = value.metrics.map(metricKey);
  if (new Set(keys).size !== keys.length) issue('metrics', 'Duplicate resource/scope. Combine its usage once.');
});

export type BudgetSnapshot = z.infer<typeof budgetSnapshotSchema>;
type Metric = BudgetSnapshot['metrics'][number];
export type BudgetStatus = 'ok' | 'headroom' | 'exceeded' | 'unknown';
export interface BudgetRow {
  resource: Metric['resource'];
  scope: string;
  unit: 'bytes' | 'count' | 'average bytes';
  used: number | null;
  allowance: number | null;
  remaining: number | null;
  projected: number | null;
  projectedRemaining: number | null;
  headroomLimit: number | null;
  status: BudgetStatus;
  method: string;
  issues: string[];
}

export interface BudgetReport {
  generatedAt: string;
  source: BudgetSnapshot['source'];
  organization: string;
  plan: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  capturedAt: string | null;
  usageThrough: string | null;
  headroomPercent: number;
  status: BudgetStatus | 'incomplete';
  issues: string[];
  rows: BudgetRow[];
}

function metricKey(metric: Metric): string {
  return `${metric.resource}:${'project' in metric ? metric.project : 'organization'}`;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** No network or database access. Unknown inputs never become zero usage. */
export function buildBudgetReport(input: unknown, now = new Date()): BudgetReport {
  const parsed = budgetSnapshotSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid snapshot:\n${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n')}`);
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid report time.');
  const snapshot = parsed.data;
  const issues: string[] = [];
  if (snapshot.source === 'example') issues.push('Example data: this is not an assessment of a real account.');
  if (!snapshot.plan) issues.push('Plan and allowances have not been confirmed against the dashboard.');
  if (snapshot.allProjectsIncluded !== true) issues.push('Organization totals have not been confirmed to include every project and consumer.');
  for (const field of ['periodStart', 'periodEnd', 'capturedAt', 'usageThrough'] as const) {
    const value = snapshot[field];
    if (!value) issues.push(`Missing ${field}.`);
    else if (field !== 'periodEnd' && Date.parse(value) > now.getTime()) throw new Error(`${field} cannot be in the future relative to report time.`);
  }
  for (const field of ['capturedAt', 'usageThrough'] as const) {
    const value = snapshot[field];
    if (value && now.getTime() - Date.parse(value) > snapshot.maxAgeHours * HOUR_MS) issues.push(`${field} is stale (older than ${snapshot.maxAgeHours} hours). Refresh the snapshot.`);
  }
  if (snapshot.periodEnd && now.getTime() >= Date.parse(snapshot.periodEnd)) issues.push('This billing period has ended. Supply the new period and its usage; usage is not automatically carried forward or reset.');

  const window = snapshot.periodStart && snapshot.periodEnd && snapshot.usageThrough ? {
    elapsedDays: (Date.parse(snapshot.usageThrough) - Date.parse(snapshot.periodStart)) / DAY_MS,
    remainingDays: (Date.parse(snapshot.periodEnd) - Date.parse(snapshot.usageThrough)) / DAY_MS,
    totalDays: (Date.parse(snapshot.periodEnd) - Date.parse(snapshot.periodStart)) / DAY_MS,
  } : null;

  const rows: BudgetRow[] = snapshot.metrics.map((metric) => {
    const rowIssues: string[] = [];
    let projected: number | null = null;
    let method = 'Projection unavailable.';
    const averaged = metric.resource === 'storage_size' || metric.resource === 'disk_size';
    if (metric.used === null) rowIssues.push('Usage is unknown.');
    if (metric.allowance === null) rowIssues.push('Allowance is unknown.');
    if (!window) rowIssues.push('Billing period or usage cutoff is missing.');
    if (window && metric.used !== null) {
      if (window.remainingDays === 0) {
        projected = metric.used;
        method = 'Final observed usage for the completed period.';
        if ('additionalUsage' in metric && metric.additionalUsage > 0) rowIssues.push('Additional future usage cannot be included in a completed period.');
      } else if ('dailyUsage' in metric) {
        const rate = metric.dailyUsage ?? (
          window.elapsedDays * 24 >= snapshot.minimumElapsedHours
            ? metric.used / window.elapsedDays : null
        );
        if (rate === null) rowIssues.push(`Fewer than ${snapshot.minimumElapsedHours} observed hours; supply dailyUsage or collect more data.`);
        else {
          projected = metric.used + rate * window.remainingDays + metric.additionalUsage;
          method = metric.dailyUsage === null
            ? 'Period-to-date average daily usage, plus additionalUsage.'
            : 'Explicit future dailyUsage, plus additionalUsage (replaces the observed daily rate).';
        }
      } else if (metric.growthPerDay === null) {
        rowIssues.push('Future growthPerDay is unknown; enter 0 explicitly to assume constant size.');
      } else if ('currentSize' in metric) {
        if (metric.currentSize === null) rowIssues.push('Current size is unknown.');
        else {
          // Integrate linear future size, then divide by the actual period length.
          // Multiplying each day by 24 gives the equivalent byte-hours formula.
          projected = (metric.used * window.elapsedDays
            + metric.currentSize * window.remainingDays
            + metric.growthPerDay * window.remainingDays ** 2 / 2) / window.totalDays;
          method = 'Time-weighted period average: observed average plus current size and explicit linear growth.';
        }
      } else {
        projected = metric.used + metric.growthPerDay * window.remainingDays;
        method = 'Current database size plus explicit growth; capacity does not reset with the billing period.';
      }
    }
    const headroomLimit = metric.allowance === null ? null : metric.allowance * (1 - snapshot.headroomPercent / 100);
    const knownValues = [metric.used, projected].filter((value): value is number => value !== null);
    const peak = knownValues.length ? Math.max(...knownValues) : null;
    const status: BudgetStatus = peak !== null && metric.allowance !== null && peak > metric.allowance
      ? 'exceeded'
      : peak !== null && headroomLimit !== null && peak > 0 && peak >= headroomLimit
        ? 'headroom'
        : rowIssues.length ? 'unknown' : 'ok';
    return {
      resource: metric.resource,
      scope: 'project' in metric ? metric.project : 'organization',
      unit: averaged ? 'average bytes' : metric.resource === 'edge_function_invocations' ? 'count' : 'bytes',
      used: metric.used,
      allowance: metric.allowance,
      remaining: metric.allowance !== null && metric.used !== null ? metric.allowance - metric.used : null,
      projected,
      projectedRemaining: metric.allowance !== null && projected !== null ? metric.allowance - projected : null,
      headroomLimit,
      status,
      method,
      issues: rowIssues,
    };
  });
  // Known overruns remain visible even when other inputs are incomplete.
  const status = rows.some((row) => row.status === 'exceeded') ? 'exceeded'
    : issues.length || rows.some((row) => row.issues.length) ? 'incomplete'
      : rows.some((row) => row.status === 'headroom') ? 'headroom' : 'ok';
  return {
    generatedAt: now.toISOString(), source: snapshot.source,
    organization: snapshot.organization, plan: snapshot.plan,
    periodStart: snapshot.periodStart, periodEnd: snapshot.periodEnd,
    capturedAt: snapshot.capturedAt, usageThrough: snapshot.usageThrough,
    headroomPercent: snapshot.headroomPercent, status, issues, rows,
  };
}

const labels: Record<Metric['resource'], string> = {
  uncached_egress: 'Uncached egress', cached_egress: 'Cached egress',
  edge_function_invocations: 'Edge Function invocations', storage_size: 'Storage size',
  database_size: 'Database capacity', disk_size: 'Provisioned disk size',
};

function escape(value: string): string { return value.replace(/[|<>\r\n]/g, ' '); }
function format(value: number | null, unit: BudgetRow['unit']): string {
  if (value === null) return 'unknown';
  const number = (amount: number) => amount.toLocaleString('en-US', { maximumFractionDigits: 3 });
  if (unit === 'count') return number(value);
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log10(Math.abs(value) || 1) / 3)));
  return `${number(value / 1000 ** index)} ${units[index]}${unit === 'average bytes' ? ' avg' : ''}`;
}

export function renderBudgetReport(report: BudgetReport): string {
  return [
    '# Supabase usage budget report', '',
    `Status: **${report.status.toUpperCase()}**. ${report.source === 'example' ? '**EXAMPLE DATA — not your account.**' : 'Dashboard snapshot; no live account fetch.'}`, '',
    `Organization: ${escape(report.organization)}. Plan: ${escape(report.plan ?? 'unknown')}.`,
    `Period: ${report.periodStart ?? 'unknown'} → ${report.periodEnd ?? 'unknown'} (end exclusive).`,
    `Usage through: ${report.usageThrough ?? 'unknown'}. Captured: ${report.capturedAt ?? 'unknown'}.`,
    `Generated: ${report.generatedAt}. Reserved headroom: ${report.headroomPercent}%.`, '',
    'Covers the configured resource budgets only. Amounts are usage, not a price estimate or a change to Supabase limits.',
    'GB uses 1,000,000,000 bytes. Negative remaining amounts mean an overrun. Storage/disk values are period averages.', '',
    '| Resource | Scope | Used | Allowance | Remaining | Projected end | Projected remaining | Status |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...report.rows.map((row) => `| ${labels[row.resource]} | ${escape(row.scope)} | ${format(row.used, row.unit)} | ${format(row.allowance, row.unit)} | ${format(row.remaining, row.unit)} | ${format(row.projected, row.unit)} | ${format(row.projectedRemaining, row.unit)} | ${row.status} |`), '',
    '## Assumptions and data gaps', '',
    ...report.issues.map((issue) => `- ${issue}`),
    ...report.rows.flatMap((row) => [
      `- ${labels[row.resource]} (${escape(row.scope)}): ${row.method} Headroom boundary: ${format(row.headroomLimit, row.unit)}.`,
      ...row.issues.map((issue) => `- ${labels[row.resource]} (${escape(row.scope)}): ${issue}`),
    ]), '',
    'Projections extend from the usage cutoff, including reporting lag. Observed trends already include existing study, devices and other consumers; additionalUsage must contain only extra future work.', '',
  ].join('\n');
}
