// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTO_REPORT_MS,
  maybeAutoReport,
  resetAutoReportState,
  shouldAutoReport,
} from '../src/lib/autoSlowReport';
import type { PageTiming } from '../src/lib/pageTiming';

function timing(overrides: Partial<PageTiming> = {}): PageTiming {
  return {
    path: '/books/b1',
    ms: 60_000,
    maxStallMs: 10,
    syncRunning: false,
    syncStage: 'idle',
    initial: false,
    timedOut: true,
    at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  resetAutoReportState();
});

describe('shouldAutoReport', () => {
  it('ignores ordinary slow loads and accepts 30s+ or timed-out ones', () => {
    expect(shouldAutoReport(timing({ ms: 8_000, timedOut: false }), { sent: [] })).toBe(false);
    expect(shouldAutoReport(timing({ ms: AUTO_REPORT_MS, timedOut: false }), { sent: [] })).toBe(true);
    expect(shouldAutoReport(timing({ ms: 20_000, timedOut: true }), { sent: [] })).toBe(true);
  });

  it('rate-limits per path and per day', () => {
    const now = new Date('2026-11-27T12:00:00Z');
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
    expect(shouldAutoReport(timing(), { sent: [{ path: '/books/b1', at: hoursAgo(1) }] }, now)).toBe(false);
    expect(shouldAutoReport(timing(), { sent: [{ path: '/books/b1', at: hoursAgo(7) }] }, now)).toBe(true);
    const three = ['/a', '/b', '/c'].map((path) => ({ path, at: hoursAgo(2) }));
    expect(shouldAutoReport(timing(), { sent: three }, now)).toBe(false);
  });
});

describe('maybeAutoReport', () => {
  it('files once per timing and records it for the cooldown', async () => {
    const file = vi.fn().mockResolvedValue(undefined);
    const t = timing();
    expect(await maybeAutoReport(t, file)).toBe(true);
    expect(await maybeAutoReport(t, file)).toBe(false);
    expect(await maybeAutoReport(timing({ at: new Date(Date.now() + 1000).toISOString() }), file)).toBe(false);
    expect(file).toHaveBeenCalledTimes(1);
    expect(file.mock.calls[0]![0]).toContain('Auto-reported slow page: /books/b1');
  });

  it('skips hidden pages and does not record a failed write', async () => {
    const file = vi.fn().mockRejectedValue(new Error('db'));
    expect(await maybeAutoReport(timing(), file, { visible: false })).toBe(false);
    expect(file).not.toHaveBeenCalled();
    expect(await maybeAutoReport(timing({ at: 'x2' }), file)).toBe(false);
    const ok = vi.fn().mockResolvedValue(undefined);
    expect(await maybeAutoReport(timing({ at: 'x3' }), ok)).toBe(true);
  });
});
