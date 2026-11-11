import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

const ACTIVE_JOB_KEY = 'quickmine.activeJob';

const readyJob = (transcriptSource: 'asr' | 'auto-caption' = 'asr') => ({
  jobId: 'job-1',
  status: 'ready',
  stage: 'ready',
  message: 'Transcript ready',
  elapsedSeconds: 5,
  transcriptSource,
  source: { id: 'yt-1', type: 'youtube', url: 'https://example.invalid/watch', videoId: 'abc', title: 'テスト動画' },
  transcript: [
    { text: '今日は雨です', startMs: 0, endMs: 2000 },
    { text: '私は本を読みます', startMs: 2000, endMs: 4000 },
    { text: '明日は晴れます', startMs: 4000, endMs: 6000 },
  ],
});

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function savePointer(page: Page) {
  await page.goto('/#/settings');
  await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ jobId: 'job-1', savedAt: Date.now() })), ACTIVE_JOB_KEY);
}

for (const size of WIDTHS) {
  test.describe(`${size.name} width`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test.beforeEach(async ({ page }) => {
      await page.route('**/youtube-mining/jobs', (route) => route.fulfill({ json: [] }));
    });

    test('a swept job clears the saved pointer and leaves the form usable', async ({ page }) => {
      await page.route('**/youtube-mining/jobs/job-1', (route) => route.fulfill({ status: 404, json: { detail: 'job not found' } }));
      await savePointer(page);
      await page.goto('/#/import/quick');
      await expect(page.getByText(/Could not reconnect to your last mining job/)).toBeVisible();
      expect(await page.evaluate((key) => localStorage.getItem(key), ACTIVE_JOB_KEY)).toBeNull();
      await expect(page.getByPlaceholder('https://www.youtube.com/watch?v=…')).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    test('a failed job reports its error and clears the pointer', async ({ page }) => {
      await page.route('**/youtube-mining/jobs/job-1', (route) => route.fulfill({
        json: { jobId: 'job-1', status: 'error', stage: 'error', message: 'failed', error: 'yt-dlp was blocked' },
      }));
      await savePointer(page);
      await page.goto('/#/import/quick');
      await expect(page.getByText('yt-dlp was blocked')).toBeVisible();
      expect(await page.evaluate((key) => localStorage.getItem(key), ACTIVE_JOB_KEY)).toBeNull();
      await expectNoHorizontalOverflow(page);
    });

    test('a dropped connection keeps the pointer and resumes to the prompt once the service answers', async ({ page }) => {
      let calls = 0;
      await page.route('**/youtube-mining/jobs/job-1', async (route) => {
        calls += 1;
        if (calls === 1) { await route.fulfill({ status: 503, json: { detail: 'busy' } }); return; }
        await route.fulfill({ json: readyJob('auto-caption') });
      });
      await savePointer(page);
      await page.goto('/#/import/quick');
      await expect.poll(() => calls).toBeGreaterThanOrEqual(1);
      // A transient 503 is not "job gone": the pointer must survive for the retry.
      expect(await page.evaluate((key) => localStorage.getItem(key), ACTIVE_JOB_KEY)).toContain('job-1');
      // The page retries on its own after a few seconds.
      await expect(page.getByText('テスト動画')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/Segmented from YouTube auto-captions/)).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    test('an in-progress import can be picked from the list and a partial reply is flagged before commit', async ({ page }) => {
      await page.route('**/youtube-mining/jobs', (route) => route.fulfill({
        json: [{ jobId: 'job-1', url: 'https://example.invalid/watch', title: 'テスト動画', status: 'ready', stage: 'ready', message: 'ready', createdAt: Date.now() }],
      }));
      await page.route('**/youtube-mining/jobs/job-1', (route) => route.fulfill({ json: readyJob() }));
      await page.goto('/#/import/quick');
      await page.getByRole('button', { name: /テスト動画/ }).click();
      await expect(page.getByText('Segment + translate with AI help').or(page.getByText('テスト動画').first())).toBeVisible();

      // A reply covering only the first of three transcript fragments must not slip through silently.
      await page.getByPlaceholder(/Paste the assistant's reply here/).fill('[0:00] 今日は雨です。 || It is raining today.');
      await page.getByRole('button', { name: /Apply pasted reply/ }).click();
      await expect(page.getByText(/1 sentences? — give them a skim/)).toBeVisible();
      await expect(page.getByText(/This reply may be incomplete/)).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Nothing is imported or scheduled just by reviewing.
      const counts = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('satori-glossbook');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const count = (store: string) => new Promise<number>((resolve, reject) => {
          const request = db.transaction(store).objectStore(store).count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const result = { sentences: await count('sentences'), studyItems: await count('studyItems') };
        db.close();
        return result;
      });
      expect(counts).toEqual({ sentences: 0, studyItems: 0 });
    });
  });
}
