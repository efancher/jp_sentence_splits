import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/performance',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0, // Never hide a slow/failed sample with a successful retry.
  forbidOnly: !!process.env.CI,
  timeout: 180_000,
  expect: { timeout: 30_000 }, // Functional stall guard, not a calibrated speed limit.
  outputDir: 'test-results/performance/browser',
  reporter: [['list'], ['./e2e/performance/reporter.ts']],
  use: {
    baseURL: 'http://127.0.0.1:4183',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4183 --strictPort',
    url: 'http://127.0.0.1:4183',
    reuseExistingServer: process.env.PERF_REUSE_SERVER === '1',
    timeout: 180_000,
    env: { GITHUB_ACTIONS: 'false', VITE_DEPLOY: '0', VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit-phone', use: { ...devices['iPhone 13'] } },
  ],
});
