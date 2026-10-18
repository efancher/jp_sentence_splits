import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/performance/**', // Controlled measurements use their own config.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['clause-pilot.spec.ts', 'book-extras.spec.ts', 'review-document.spec.ts', 'reader-walkthrough.spec.ts', 'episode-preparation.spec.ts', 'sentence-lesson.spec.ts', 'real-chapter.spec.ts', 'native-pitch-practice.spec.ts'],
    },
    {
      name: 'webkit',
      use: { ...devices['iPhone 13'] },
    },
  ],
});
