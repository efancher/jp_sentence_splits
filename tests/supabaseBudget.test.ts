import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import example from '../fixtures/performance/supabase-budget.example.json';
import template from '../fixtures/performance/supabase-budget.template.json';
import { buildBudgetReport, renderBudgetReport, type BudgetSnapshot } from '../scripts/lib/supabaseBudget';
import { runBudgetReport } from '../scripts/report-supabase-budget';

const now = new Date('2026-10-16T00:00:00Z');
function snapshot(): BudgetSnapshot {
  return { ...structuredClone(example), source: 'dashboard' } as BudgetSnapshot;
}
function single(metric: BudgetSnapshot['metrics'][number]) {
  return { ...snapshot(), metrics: [metric] };
}
const egress = { resource: 'uncached_egress' as const, used: 150, allowance: 400, dailyUsage: null, additionalUsage: 0 };

describe('Supabase billing-period budget report', () => {
  it('projects from the real period length and keeps cached/uncached allowances separate', () => {
    const report = buildBudgetReport(snapshot(), now);
    expect(report.rows[0]!.projected).toBeCloseTo(2e9 / 15 * 31 + 1e9);
    expect(report.rows[0]!.status).toBe('exceeded');
    expect(report.rows[0]!.projectedRemaining).toBeLessThan(0);
    expect(report.rows[1]!.status).toBe('ok');
    expect(report.status).toBe('exceeded');
  });

  it('explicit future rates replace the observed rate and additional work is added once', () => {
    const report = buildBudgetReport(single({ ...egress, dailyUsage: 2, additionalUsage: 3 }), now);
    expect(report.rows[0]!.projected).toBe(185); // 150 + 2 * 16 + 3
  });

  it('weights average storage by elapsed/future time instead of multiplying live size by days', () => {
    const report = buildBudgetReport(single({ resource: 'storage_size', used: 900, allowance: 1000, currentSize: 300, growthPerDay: 0 }), now);
    expect(report.rows[0]!.projected).toBeCloseTo((900 * 15 + 300 * 16) / 31);
    expect(report.rows[0]!.status).toBe('headroom'); // Historical average still uses headroom.
    expect(report.rows[0]!.unit).toBe('average bytes');
  });

  it('integrates explicit growth for provisioned disk and treats database capacity as a gauge', () => {
    const disk = buildBudgetReport(single({ resource: 'disk_size', project: 'project-a', used: 100, allowance: 1000, currentSize: 200, growthPerDay: 10 }), now);
    expect(disk.rows[0]!.projected).toBeCloseTo((100 * 15 + 200 * 16 + 10 * 16 ** 2 / 2) / 31);
    const db = buildBudgetReport(single({ resource: 'database_size', project: 'project-a', used: 200, allowance: 1000, growthPerDay: 10 }), now);
    expect(db.rows[0]!.projected).toBe(360);
  });

  it('counts reporting lag from usageThrough, not the later capture time', () => {
    const input = single(egress);
    input.usageThrough = '2026-10-15T00:00:00Z';
    expect(buildBudgetReport(input, now).rows[0]!.projected).toBeCloseTo(150 / 14 * 31);
  });

  it('requires enough observations before extrapolating cumulative usage', () => {
    const input = single(egress);
    input.periodStart = '2026-10-15T23:00:00Z';
    const report = buildBudgetReport(input, now);
    expect(report.status).toBe('incomplete');
    expect(report.rows[0]!.projected).toBeNull();
    input.metrics = [{ ...egress, dailyUsage: 1 }];
    expect(buildBudgetReport(input, now).rows[0]!.projected).not.toBeNull();
  });

  it('handles zero elapsed time without infinity or NaN', () => {
    const input = single({ ...egress, used: 0 });
    input.periodStart = input.usageThrough;
    expect(buildBudgetReport(input, now).rows[0]!.projected).toBeNull();
  });

  it('leaves missing inputs unknown instead of presenting the blank template as safe', () => {
    const report = buildBudgetReport(template, now);
    expect(report.status).toBe('incomplete');
    expect(report.rows.every((row) => row.projected === null && row.status === 'unknown')).toBe(true);
    expect(renderBudgetReport(report)).toContain('unknown');
  });

  it('flags example data even when every configured budget is otherwise healthy', () => {
    const input = { ...single(egress), source: 'example' };
    expect(buildBudgetReport(input, now).status).toBe('incomplete');
    expect(renderBudgetReport(buildBudgetReport(input, now))).toContain('EXAMPLE DATA');
  });

  it.each([['capturedAt', '2026-10-10T00:00:00Z'], ['usageThrough', '2026-10-10T00:00:00Z']] as const)('flags stale %s', (field, value) => {
    const input = single(egress);
    input.usageThrough = '2026-10-10T00:00:00Z';
    input[field] = value;
    expect(buildBudgetReport(input, now).issues.join(' ')).toContain(`${field} is stale`);
  });

  it('does not silently reset expired periods or carry usage into a new cycle', () => {
    const report = buildBudgetReport(single(egress), new Date('2026-11-01T00:00:00Z'));
    expect(report.status).toBe('incomplete');
    expect(report.rows[0]!.used).toBe(150);
    expect(report.issues.join(' ')).toContain('billing period has ended');
  });

  it('uses the final observation at the period boundary and disallows extra future work there', () => {
    const input = single({ ...egress, additionalUsage: 100 });
    input.usageThrough = input.capturedAt = input.periodEnd;
    const report = buildBudgetReport(input, new Date(input.periodEnd!));
    expect(report.rows[0]!.projected).toBe(150);
    expect(report.rows[0]!.issues.join(' ')).toContain('completed period');
  });

  it('requires explicit growth assumptions and flags partial organization coverage', () => {
    const input = single({ resource: 'database_size', project: 'p', used: 10, allowance: 100, growthPerDay: null });
    input.allProjectsIncluded = false;
    const report = buildBudgetReport(input, now);
    expect(report.rows[0]!.projected).toBeNull();
    expect(report.issues.join(' ')).toContain('every project');
    expect(report.status).toBe('incomplete');
  });

  it('warns exactly at reserved headroom and accepts explicit zero allowances without NaN', () => {
    expect(buildBudgetReport(single({ ...egress, used: 320, dailyUsage: 0 }), now).status).toBe('headroom');
    expect(buildBudgetReport(single({ ...egress, used: 0, allowance: 0 }), now).status).toBe('ok');
    expect(buildBudgetReport(single({ ...egress, used: 1, allowance: 0 }), now).status).toBe('exceeded');
  });

  it.each([
    { periodEnd: '2026-09-30T00:00:00Z' },
    { usageThrough: '2026-09-30T00:00:00Z' },
    { capturedAt: '2026-10-17T00:00:00Z' },
    { headroomPercent: 100 },
    { metrics: [{ ...egress, used: -1 }] },
    { metrics: [{ ...egress, used: '150' }] },
    { metrics: [egress, egress] },
    { metrics: [{ ...egress, unit: 'GB' }] },
  ])('rejects ambiguous or invalid input: %j', (override) => {
    expect(() => buildBudgetReport({ ...snapshot(), ...override }, now)).toThrow();
  });

  it('supports a non-calendar billing cycle and timezone offsets', () => {
    const input = single({ ...egress, used: 20 });
    input.periodStart = '2026-10-10T02:00:00+02:00';
    input.periodEnd = '2026-11-09T00:00:00Z';
    expect(buildBudgetReport(input, now).rows[0]!.projected).toBe(100);
  });
});

describe('budget report command', () => {
  it('writes reviewable reports, preserves the input and returns warning status only with --check', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'satori-budget-'));
    const input = resolve(directory, 'input.json');
    const output = resolve(directory, 'out');
    const before = JSON.stringify(example);
    writeFileSync(input, before);
    try {
      const args = ['--input', input, '--now', now.toISOString(), '--output', output];
      expect(runBudgetReport(args, vi.fn())).toBe(0);
      expect(runBudgetReport([...args, '--check'], vi.fn())).toBe(2);
      expect(JSON.parse(readFileSync(resolve(output, 'report.json'), 'utf8')).status).toBe('exceeded');
      expect(readFileSync(resolve(output, 'report.md'), 'utf8')).toContain('EXAMPLE DATA');
      expect(readFileSync(input, 'utf8')).toBe(before);
      const collidingInput = resolve(directory, 'report.json');
      writeFileSync(collidingInput, before);
      expect(() => runBudgetReport(['--input', collidingInput, '--now', now.toISOString(), '--output', directory], vi.fn())).toThrow('overwrite the input');
      expect(readFileSync(collidingInput, 'utf8')).toBe(before);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('provides help and rejects malformed flags/dates before reading files', () => {
    const out = vi.fn();
    expect(runBudgetReport(['--help'], out)).toBe(0);
    expect(out).toHaveBeenCalledWith(expect.stringContaining('no network requests'));
    for (const args of [[], ['--wat'], ['--input'], ['--input', 'x', '--input', 'y'], ['--now', '2026-02-30T00:00:00Z']]) {
      expect(() => runBudgetReport(args, out)).toThrow();
    }
  });
});
