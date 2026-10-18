import { expect, test, type Page } from '@playwright/test';
import { libraries, seedLibrary } from './fixture';

const repetitions = Number(process.env.PERF_SAMPLES ?? 5);
const latencyMs = Number(process.env.PERF_LATENCY_MS ?? 0);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100) throw new Error('PERF_SAMPLES must be an integer from 1 to 100');
if (!Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > 2000) throw new Error('PERF_LATENCY_MS must be between 0 and 2000');

const screens = [
  { name: 'Home', hash: '#/', ready: async (page: Page) => {
    await expect(page.getByRole('button', { name: /^Start \(/ })).toBeEnabled();
    await expect(page.getByText('Loading…', { exact: true })).toHaveCount(0);
  } },
  { name: 'Books', hash: '#/books', ready: async (page: Page) => {
    await expect(page.getByRole('button', { name: 'Open', exact: true }).first()).toBeEnabled();
  } },
  { name: 'Reader', hash: '#/books/perf-book-0/read?chapter=perf-book-0-chapter-0', ready: async (page: Page) => {
    await expect(page.getByRole('toolbar', { name: 'Sentence tools' }).getByRole('button', { name: 'Walk through', exact: true })).toBeEnabled();
  } },
  { name: 'Review', hash: '#/review', ready: async (page: Page) => {
    await expect(page.getByText('Which English sentence is the meaning of this sentence in context?')).toBeVisible();
    await expect(page.getByRole('button', { name: /I read a book\./ })).toBeEnabled();
  } },
];

for (const size of Object.keys(libraries) as Array<keyof typeof libraries>) {
  for (const screen of screens) {
    test(`${size} library / ${screen.name}`, async ({ page, context, browser }, info) => {
      test.setTimeout(Math.max(180_000, repetitions * 60_000));
      const external: string[] = [];
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      // Routing disables the browser HTTP cache. Service workers are also blocked.
      // Never let a misconfigured build contact a production API.
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://127.0.0.1:4183') {
          external.push(url.origin);
          await route.abort();
          return;
        }
        if (latencyMs) await new Promise((resolve) => setTimeout(resolve, latencyMs));
        await route.continue();
      });
      const timings: Record<string, number[]> = { document: [], warm: [], offline: [] };
      await page.goto('/#/settings');
      await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
      const fixture = await seedLibrary(page, size);
      for (let i = 0; i < repetitions; i++) {
        await context.setOffline(false);
        // A new document/JS runtime with an existing local library, not first install.
        await page.goto('about:blank');
        await page.goto(`/${screen.hash}`, { waitUntil: 'commit' });
        await screen.ready(page);
        timings.document.push(await page.evaluate(async () => {
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          return performance.now();
        }));
        for (const mode of ['warm', 'offline'] as const) {
          await page.evaluate(() => { location.hash = '#/settings'; });
          await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
          await context.setOffline(mode === 'offline');
          const start = await page.evaluate((hash) => { const start = performance.now(); location.hash = hash; return start; }, screen.hash);
          await screen.ready(page);
          timings[mode].push(await page.evaluate(async () => {
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            return performance.now();
          }) - start);
        }
      }
      expect(external, 'local-only screens must not call external services').toEqual([]);
      expect(errors, 'readiness must not conceal application errors').toEqual([]);
      await info.attach('performance-sample', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
        screen: screen.name, library: size, project: info.project.name, browserVersion: browser.version(),
        latencyMs, fixture, timings, externalRequests: external.length,
      })) });
    });
  }
}
