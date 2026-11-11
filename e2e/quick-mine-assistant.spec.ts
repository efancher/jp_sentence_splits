import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

const ACTIVE_JOB_KEY = 'quickmine.activeJob';
const SENTENCES_REPLY = [
  '[0:00] 今日は雨です。 || It is raining today.',
  '[0:02] 私は本を読みます。 || I read a book.',
  '[0:04] 明日は晴れます。 || It will be sunny tomorrow.',
].join('\n');

const readyJob = {
  jobId: 'job-1',
  status: 'ready',
  stage: 'ready',
  message: 'Transcript ready',
  elapsedSeconds: 5,
  transcriptSource: 'asr',
  source: { id: 'yt-1', type: 'youtube', url: 'https://example.invalid/watch', videoId: 'abc', title: 'テスト動画' },
  transcript: [
    { text: '今日は雨です', startMs: 0, endMs: 2000 },
    { text: '私は本を読みます', startMs: 2000, endMs: 4000 },
    { text: '明日は晴れます', startMs: 4000, endMs: 6000 },
  ],
};

const run = (overrides: Record<string, unknown>) => ({
  status: 'running',
  phase: 'sentences',
  progress: 'Segmenting part 1 of 1…',
  segmentsDone: 0,
  segmentsTotal: 1,
  log: [],
  updatedAt: Date.now(),
  ...overrides,
});

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Resume the saved job so the page lands on the prompt (combine) step. */
async function openPrompt(page: Page) {
  await page.goto('/#/settings');
  await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ jobId: 'job-1', savedAt: Date.now() })), ACTIVE_JOB_KEY);
  await page.goto('/#/import/quick');
  await expect(page.getByRole('button', { name: /Send to assistant|Resume with assistant/ })).toBeVisible();
}

for (const size of WIDTHS) {
  test.describe(`${size.name} width`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test.beforeEach(async ({ page }) => {
      await page.route('**/youtube-mining/jobs', (route) => route.fulfill({ json: [] }));
      await page.route('**/youtube-mining/jobs/job-1', (route) => route.fulfill({ json: readyJob }));
    });

    test('a running assistant locks the controls, then a finished run lands in review', async ({ page }) => {
      let started = 0;
      let polls = 0;
      await page.route('**/youtube-mining/assist-runs', async (route) => {
        started += 1;
        await route.fulfill({ json: run({}) });
      });
      await page.route('**/youtube-mining/assist-runs/job-1', async (route) => {
        if (route.request().method() !== 'GET') { await route.fulfill({ status: 204 }); return; }
        polls += 1;
        // First check (page load) finds no run; later polls see it running, then done.
        if (polls === 1) { await route.fulfill({ status: 404, json: { detail: 'no run' } }); return; }
        if (polls <= 3) {
          await route.fulfill({ json: run({ progress: 'Translating part 1 of 1…', live: { backend: 'codex', startedAt: Date.now() - 4000, timeoutSeconds: 300 } }) });
          return;
        }
        await route.fulfill({ json: run({ status: 'done', phase: null, progress: '', segmentsDone: 1, sentencesReply: SENTENCES_REPLY }) });
      });

      await openPrompt(page);
      await page.getByRole('button', { name: 'Send to assistant' }).click();
      await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Send to assistant' })).toBeDisabled();
      await expect(page.getByText(/Translating part 1 of 1/)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/codex/).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await expect(page.getByText(/3 sentences — give them a skim/)).toBeVisible({ timeout: 20_000 });
      expect(started).toBe(1);
      await expectNoHorizontalOverflow(page);
    });

    test('a failed run keeps its partial sentences reviewable and can be resumed', async ({ page }) => {
      let started = 0;
      await page.route('**/youtube-mining/assist-runs', async (route) => {
        started += 1;
        await route.fulfill({
          json: run({ status: 'failed', failure: 'Both assistants timed out on part 2.', sentencesReply: SENTENCES_REPLY, log: [{ at: Date.now(), text: 'codex timed out' }] }),
        });
      });
      await page.route('**/youtube-mining/assist-runs/job-1', (route) => route.fulfill({ status: 404, json: { detail: 'no run' } }));

      await openPrompt(page);
      await page.getByRole('button', { name: 'Send to assistant' }).click();
      await expect(page.getByText(/Both assistants timed out on part 2/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Resume with assistant' })).toBeEnabled();
      await expect(page.getByText(/Activity \(1\)/)).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Resuming re-posts the run rather than starting over locally.
      await page.getByRole('button', { name: 'Resume with assistant' }).click();
      await expect.poll(() => started).toBe(2);

      await page.getByRole('button', { name: /Review the sentences now/ }).click();
      await expect(page.getByText(/3 sentences — give them a skim/)).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    test('a start error is shown and the button stays usable', async ({ page }) => {
      await page.route('**/youtube-mining/assist-runs', (route) => route.fulfill({ status: 503, json: { detail: 'box is busy' } }));
      await page.route('**/youtube-mining/assist-runs/job-1', (route) => route.fulfill({ status: 404, json: { detail: 'no run' } }));

      await openPrompt(page);
      await page.getByRole('button', { name: 'Send to assistant' }).click();
      await expect(page.getByText(/box is busy/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Resume with assistant/ })).toBeEnabled();
      await expectNoHorizontalOverflow(page);
    });

    test('Stop cancels the run and frees the controls', async ({ page }) => {
      let cancelled = false;
      await page.route('**/youtube-mining/assist-runs', (route) => route.fulfill({ json: run({}) }));
      await page.route('**/youtube-mining/assist-runs/job-1', async (route) => {
        if (route.request().method() !== 'GET') { await route.fulfill({ status: 204 }); return; }
        await route.fulfill(cancelled ? { json: run({ status: 'cancelled' }) } : { status: 404, json: { detail: 'no run' } });
      });
      await page.route('**/youtube-mining/assist-runs/job-1/cancel', async (route) => {
        cancelled = true;
        await route.fulfill({ status: 204 });
      });

      await openPrompt(page);
      await page.getByRole('button', { name: 'Send to assistant' }).click();
      await page.getByRole('button', { name: 'Stop' }).click();
      await expect.poll(() => cancelled).toBe(true);
      // The next status poll reports "cancelled", which releases the controls without an error.
      await expect(page.getByRole('button', { name: 'Send to assistant' })).toBeEnabled({ timeout: 10_000 });
      await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
      await expect(page.locator('.error')).toHaveCount(0);
    });

    test('a run that finished while the page was closed is picked up on return', async ({ page }) => {
      await page.route('**/youtube-mining/assist-runs/job-1', (route) => route.fulfill({
        json: run({ status: 'done', phase: null, progress: '', segmentsDone: 1, sentencesReply: SENTENCES_REPLY }),
      }));
      await page.goto('/#/settings');
      await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
      await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ jobId: 'job-1', savedAt: Date.now() })), ACTIVE_JOB_KEY);
      await page.goto('/#/import/quick');
      await expect(page.getByText(/3 sentences — give them a skim/)).toBeVisible({ timeout: 15_000 });
      await expectNoHorizontalOverflow(page);
    });
  });
}
