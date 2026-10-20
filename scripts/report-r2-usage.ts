/**
 * Reports Cloudflare R2 storage and Class A/B operation usage for the account,
 * from the GraphQL Analytics API. Read-only. See docs/CLOUDFLARE_R2_PLAN.md.
 *
 * Needs (in the environment or .env, never on the command line):
 *   CLOUDFLARE_ACCOUNT_ID         account id (not a secret)
 *   CLOUDFLARE_ANALYTICS_TOKEN    API token limited to Account Analytics: Read
 * Optional ledger comparison with the gateway's own counters:
 *   R2_GATEWAY_URL and R2_ADMIN_TOKEN
 *
 * Usage:
 *   npx tsx scripts/report-r2-usage.ts [--bucket NAME] [--period-start ISO]
 *     [--output DIR] [--check]
 * Default period start: the first of the current UTC month (R2's billing
 * cycle may differ; pass --period-start to match the dashboard). `--check`
 * exits 2 unless every metric is ok. Unknown data is never reported as zero.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { requireEnv } from './lib/env';
import { buildReport, fetchAnalytics, toMarkdown, type R2Report } from './lib/r2Usage';

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function ledgerSnapshot(): Promise<R2Report['ledger'] | undefined> {
  const url = process.env.R2_GATEWAY_URL;
  const token = process.env.R2_ADMIN_TOKEN;
  if (!url || !token) return undefined;
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/v1/admin/usage`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { storageBytes: number; classA: number; classB: number; seeded: boolean };
    return { storageBytes: body.storageBytes, classA: body.classA, classB: body.classB, seeded: body.seeded };
  } catch {
    return undefined;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID');
  const token = requireEnv('CLOUDFLARE_ANALYTICS_TOKEN');
  const bucket = flag(argv, '--bucket') ?? 'satori-reference-audio';
  const now = new Date();
  const periodStart = flag(argv, '--period-start') ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  if (Number.isNaN(Date.parse(periodStart))) throw new Error('--period-start must be an ISO timestamp');

  const analytics = await fetchAnalytics({ fetch, token, accountId, bucket, start: new Date(periodStart), end: now });
  const report = buildReport({ analytics, bucket, periodStart, now, ledger: await ledgerSnapshot() });
  const markdown = toMarkdown(report);

  const output = flag(argv, '--output');
  if (output) {
    const dir = resolve(output);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'r2-report.md'), markdown + '\n');
    writeFileSync(resolve(dir, 'r2-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`Status: ${report.status}. Wrote ${dir}/r2-report.md and r2-report.json`);
  } else {
    console.log(markdown);
  }
  if (argv.includes('--check') && report.status !== 'ok') process.exit(2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
