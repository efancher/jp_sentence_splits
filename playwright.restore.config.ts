import { defineConfig, devices } from '@playwright/test';

/**
 * Real-browser fresh-device restore measurement (docs/PERFORMANCE.md). Separate from
 * the load benchmark and the functional suite: it needs the Postgres harness seeded
 * and a preview built against the local API proxy, so `scripts/perf-restore.sh`
 * orchestrates it. Timings are report-only.
 */
export default defineConfig({
  testDir: './e2e/restore',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The spec's own deadline (RESTORE_DEADLINE_MS, default 800 s) plus room for startup and teardown.
  timeout: Number(process.env.RESTORE_DEADLINE_MS ?? 800_000) + 180_000,
  outputDir: 'test-results/performance/restore-browser',
  reporter: [['list']],
  use: {
    baseURL: process.env.RESTORE_APP_URL ?? 'http://127.0.0.1:4184',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit-phone', use: { ...devices['iPhone 13'] } },
  ],
});
