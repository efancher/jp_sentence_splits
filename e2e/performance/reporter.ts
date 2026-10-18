import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

interface Sample {
  screen: string;
  library: string;
  project: string;
  browserVersion: string;
  latencyMs: number;
  fixture: unknown;
  timings: Record<string, number[]>;
}

export function summarize(values: number[]) {
  if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Invalid timing samples');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    n: sorted.length,
    medianMs: sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
    // A five-sample maximum is not a useful p95 estimate. Retain raw samples.
    p95Ms: sorted.length >= 20 ? sorted[Math.ceil(sorted.length * 0.95) - 1]! : null,
    maxMs: sorted.at(-1)!,
  };
}

export default class PerformanceReporter implements Reporter {
  private samples: Sample[] = [];
  private failures: string[] = [];

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status !== 'passed') this.failures.push(`${test.titlePath().join(' / ')}: ${result.status}`);
    for (const attachment of result.attachments) {
      if (attachment.name === 'performance-sample' && attachment.body) this.samples.push(JSON.parse(attachment.body.toString()));
    }
  }

  onEnd(result: FullResult) {
    const directory = resolve('test-results/performance');
    mkdirSync(directory, { recursive: true });
    let revision = process.env.PERF_REVISION ?? 'unknown';
    if (revision === 'unknown') {
      try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* source archive/container */ }
    }
    const rows = this.samples.flatMap((sample) => Object.entries(sample.timings).map(([mode, values]) => ({
      ...sample, mode, ...summarize(values),
    })));
    writeFileSync(resolve(directory, 'baseline.json'), JSON.stringify({
      generatedAt: new Date().toISOString(), revision, status: result.status,
      timingGate: false, failures: this.failures, samples: this.samples,
    }, null, 2) + '\n');
    const lines = [
      '# Browser performance baseline', '',
      `Status: ${result.status}. Revision: ${revision}. Timings are observations, not CI thresholds.`, '',
      'Document = new JS runtime, existing seeded IndexedDB, HTTP cache disabled, service worker blocked.',
      'Warm/offline = in-app navigation after priming the screen. Phone is emulation, not physical hardware.',
      'Readiness waits for usable screen controls plus two animation frames; includes browser automation overhead.',
      'p95 is reported only with at least 20 samples. Fixed injected latency is not bandwidth/CPU throttling.', '',
      '| Browser/profile | Library | Screen | Mode | Added request latency | n | Median ms | p95 ms | Max ms |',
      '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
      ...rows.map((row) => `| ${row.project} | ${row.library} | ${row.screen} | ${row.mode} | ${row.latencyMs} | ${row.n} | ${row.medianMs.toFixed(1)} | ${row.p95Ms?.toFixed(1) ?? '—'} | ${row.maxMs.toFixed(1)} |`),
      '', ...this.failures.map((failure) => `Failed: ${failure}`), '',
    ];
    writeFileSync(resolve(directory, 'baseline.md'), lines.join('\n'));
  }
}
