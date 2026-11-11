import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

const ACTIVE_JOB_KEY = 'quickmine.activeJob';
const VIDEO_URL = 'https://www.youtube.com/watch?v=abc12345678';
const REPLY = [
  '=== SENTENCES ===',
  '[0:00] 今日は雨です。 || It is raining today.',
  '[0:02] 私は本を読みます。 || I read a book.',
  '[0:04] 明日は晴れます。 || It will be sunny tomorrow.',
  '=== END ===',
].join('\n');

const readyJob = {
  jobId: 'job-1',
  status: 'ready',
  stage: 'ready',
  message: 'Transcript ready',
  elapsedSeconds: 5,
  transcriptSource: 'asr',
  source: { id: 'yt-1', type: 'youtube', url: VIDEO_URL, videoId: 'abc12345678', title: 'テスト動画' },
  transcript: [
    { text: '今日は雨です', startMs: 0, endMs: 2000 },
    { text: '私は本を読みます', startMs: 2000, endMs: 4000 },
    { text: '明日は晴れます', startMs: 4000, endMs: 6000 },
  ],
};

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function startJob(page: Page) {
  await page.goto('/#/import/quick');
  await page.getByPlaceholder('https://www.youtube.com/watch?v=…').fill(VIDEO_URL);
  await page.getByRole('button', { name: 'Start' }).click();
}

for (const size of WIDTHS) {
  test.describe(`${size.name} width`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test.beforeEach(async ({ page }) => {
      await page.route('**/youtube-mining/jobs', async (route) => {
        if (route.request().method() === 'GET') { await route.fulfill({ json: [] }); return; }
        await route.fallback();
      });
    });

    test('a rejected start shows the service error and leaves the form usable', async ({ page }) => {
      await page.route('**/youtube-mining/jobs', async (route) => {
        if (route.request().method() !== 'POST') { await route.fallback(); return; }
        await route.fulfill({ status: 500, json: { detail: 'downloader unavailable' } });
      });
      await startJob(page);
      await expect(page.getByText(/downloader unavailable/)).toBeVisible();
      expect(await page.evaluate((key) => localStorage.getItem(key), ACTIVE_JOB_KEY)).toBeNull();
      await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    test('a job that fails while downloading reports the error and returns to the form', async ({ page }) => {
      await page.route('**/youtube-mining/jobs', async (route) => {
        if (route.request().method() !== 'POST') { await route.fallback(); return; }
        await route.fulfill({ json: { jobId: 'job-1' } });
      });
      await page.route('**/youtube-mining/jobs/job-1', (route) => route.fulfill({
        json: { jobId: 'job-1', status: 'error', stage: 'error', message: 'failed', error: 'video is private' },
      }));
      await startJob(page);
      await expect(page.getByText('video is private')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    test('start, poll, paste a reply, review, and commit creates sentences without study items', async ({ page, browserName }) => {
      let polls = 0;
      let commitBody: { rows: { japanese: string }[] } | undefined;
      let deleted = false;
      await page.route('**/youtube-mining/jobs', async (route) => {
        if (route.request().method() !== 'POST') { await route.fallback(); return; }
        await route.fulfill({ json: { jobId: 'job-1' } });
      });
      await page.route('**/youtube-mining/jobs/job-1', async (route) => {
        const method = route.request().method();
        if (method === 'DELETE') { deleted = true; await route.fulfill({ status: 204 }); return; }
        polls += 1;
        if (polls === 1) {
          await route.fulfill({ json: { jobId: 'job-1', status: 'fetching', stage: 'fetching', message: 'Downloading audio…', elapsedSeconds: 1 } });
          return;
        }
        await route.fulfill({ json: readyJob });
      });
      await page.route('**/youtube-mining/jobs/job-1/commit', async (route) => {
        commitBody = route.request().postDataJSON();
        const sentences = commitBody!.rows.map((row, index) => ({
          sentenceId: `clip-${index}`,
          japanese: row.japanese,
          reading: null,
          english: null,
          startMs: index * 2000,
          endMs: index * 2000 + 2000,
          subtitleStartMs: index * 2000,
          subtitleEndMs: index * 2000 + 2000,
          adjustedStartMs: index * 2000,
          adjustedEndMs: index * 2000 + 2000,
          transcriptStatus: 'unverified',
          tokens: null,
          audio: { mimeType: 'audio/mp4', durationMs: 2000 },
          audioBase64: 'AAAA',
        }));
        await route.fulfill({ json: { sentences } });
      });

      await startJob(page);
      // The pointer is saved as soon as the job exists so a reload can resume it.
      await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), ACTIVE_JOB_KEY)).toContain('job-1');
      await expect(page.getByText('Downloading audio…')).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Polling moves on to the prompt once the transcript is ready.
      await expect(page.getByText('テスト動画').first()).toBeVisible({ timeout: 15_000 });
      await page.getByPlaceholder(/Paste the assistant's reply here/).fill(REPLY);
      await page.getByRole('button', { name: /Apply pasted reply/ }).click();
      await expect(page.getByText(/3 sentences — give them a skim/)).toBeVisible();
      // The default prompt also asks for an episode pack this reply omits: flagged, but still importable.
      await expect(page.getByText(/Missing .*from the reply/)).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Dropping a row before commit is honoured.
      await page.getByRole('button', { name: 'Remove' }).last().click();
      await page.getByRole('button', { name: 'Next →' }).click();
      await expect(page.getByRole('heading', { name: 'Import preview' })).toBeVisible();
      await expect(page.getByText(/2 sentences \(2 new/)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(commitBody?.rows.map((row) => row.japanese)).toEqual([expect.stringContaining('今日は雨'), expect.stringContaining('私は本')]);

      // Playwright's Linux WebKit cannot store Blobs in IndexedDB, so the final write is Chromium-only.
      test.skip(browserName === 'webkit', 'WebKit (Linux) rejects Blob writes to IndexedDB');
      await page.getByRole('button', { name: 'Import complete project' }).click();
      await expect(page).toHaveURL(/#\/books\//);
      await expect.poll(() => deleted).toBe(true);
      expect(await page.evaluate((key) => localStorage.getItem(key), ACTIVE_JOB_KEY)).toBeNull();

      const stored = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('satori-glossbook');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const read = <T,>(store: string) => new Promise<T[]>((resolve, reject) => {
          const request = db.transaction(store).objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result as T[]);
          request.onerror = () => reject(request.error);
        });
        const sentences = await read<{ japanese: string }>('sentences');
        const items = await read<unknown>('studyItems');
        db.close();
        return { sentences, studyItemCount: items.length };
      });
      expect(stored.sentences).toHaveLength(2);
      expect(stored.studyItemCount).toBe(0);
    });
  });
}
