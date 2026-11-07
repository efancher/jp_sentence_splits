// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { hasLoadingPlaceholder, stepTimer, summarizeStepRuns } from '../src/lib/pageTiming';

function root(html: string): HTMLElement {
  const el = document.createElement('main');
  el.innerHTML = html;
  return el;
}

describe('hasLoadingPlaceholder', () => {
  it('detects page and route loading placeholders', () => {
    expect(hasLoadingPlaceholder(root('<p class="muted">Loading…</p>'))).toBe(true);
    expect(hasLoadingPlaceholder(root('<p>Loading book…</p>'))).toBe(true);
    expect(hasLoadingPlaceholder(root('<div class="route-loading">x</div>'))).toBe(true);
  });

  it('ignores loaded content and prose that merely mentions loading', () => {
    expect(hasLoadingPlaceholder(root('<h2>Books</h2><p>Session 7/22</p>'))).toBe(false);
    expect(hasLoadingPlaceholder(root('<p>Reloading the deck takes a moment, so loading is fine.</p>'))).toBe(false);
  });
});

describe('stepTimer', () => {
  it('records each concurrent promise by its own duration, plus counts', async () => {
    const timer = stepTimer('test.concurrent');
    timer.count('rows', 7);
    const wait = (ms: number) => new Promise<string>((resolve) => setTimeout(() => resolve('ok'), ms));
    const [fast, slow] = await Promise.all([timer.track('fast', wait(5)), timer.track('slow', wait(350))]);
    expect([fast, slow]).toEqual(['ok', 'ok']);
    timer.done();
    const run = summarizeStepRuns().finished.find((item) => item.name === 'test.concurrent')!;
    expect(run.counts).toEqual({ rows: 7 });
    expect(run.steps.slow).toBeGreaterThanOrEqual(300);
    expect(run.steps.fast).toBeLessThan(run.steps.slow!);
    // Concurrent steps overlap, so the run takes about as long as its slowest step, not their sum.
    expect(run.totalMs).toBeLessThan(run.steps.fast! + run.steps.slow! + 50);
  });

  it('still records a step whose promise rejects', async () => {
    const timer = stepTimer('test.reject');
    await expect(timer.track('boom', Promise.reject(new Error('x')))).rejects.toThrow('x');
    timer.done();
  });
});
