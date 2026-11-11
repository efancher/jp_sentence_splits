import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

const ACTIVE_JOB_KEY = 'quickmine.activeJob';
const EXTRAS_KEY = 'quickmine.assistExtras.job-1';
const REPLY = [
  '=== SENTENCES ===',
  '[0:00] 今日は雨です。 || It is raining today.',
  '[0:02] 私は本を読みます。 || I read a book.',
  '[0:04] 明日は晴れます。 || It will be sunny tomorrow.',
  '=== END ===',
].join('\n');
const STRUCTURE_REPLY = [
  'S1 | 今日は | topic は | today',
  'S1 | 雨です。 | engine: copula | is rain',
  'S2 | 私は | topic は | I',
  'S2 | 本を | を-car | the book',
  'S2 | 読みます。 | engine: verb | read',
  'S3 | 明日は | topic は | tomorrow',
  'S3 | 晴れます。 | engine: verb | will be sunny',
].join('\n');
const particleBlock = (chunk: string) => [
  `CHUNK: ${chunk}`,
  'Q: What does the particle do here?',
  '1. marks the topic',
  '*2. marks the thing acted on',
  '3. marks the place',
  '4. marks the speaker',
];
const PARTICLES_REPLY = [
  '=== Sentence 1 ===', 'NONE',
  '=== Sentence 2 ===', ...particleBlock('本を'),
  '=== Sentence 3 ===', 'NONE',
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

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

type Step = { reply: string } | { error: string } | 'hang';

/** Answers POST /assist and its status polls from a scripted list, one entry per request in order. */
async function scriptAssist(page: Page, steps: Step[]) {
  const prompts: string[] = [];
  await page.route('**/youtube-mining/assist', async (route) => {
    prompts.push(route.request().postDataJSON().prompt);
    await route.fulfill({ json: { assistId: `a${prompts.length - 1}` } });
  });
  await page.route('**/youtube-mining/assist/*', async (route) => {
    const index = Number(route.request().url().split('/').pop()!.slice(1));
    const step = steps[index] ?? 'hang';
    if (step === 'hang') await route.fulfill({ json: { status: 'running', backend: 'codex' } });
    else if ('error' in step) await route.fulfill({ json: { status: 'error', error: step.error } });
    else await route.fulfill({ json: { status: 'done', backend: 'codex', reply: step.reply } });
  });
  return prompts;
}

/** Resume the saved job, paste the sentences, and choose just the structure + particle extras. */
async function openReview(page: Page) {
  await page.goto('/#/settings');
  await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ jobId: 'job-1', savedAt: Date.now() })), ACTIVE_JOB_KEY);
  await page.goto('/#/import/quick');
  await page.getByPlaceholder(/Paste the assistant's reply here/).fill(REPLY);
  await page.getByRole('button', { name: /Apply pasted reply/ }).click();
  await expect(page.getByText(/3 sentences — give them a skim/)).toBeVisible();
  for (const label of ['Focus targets', 'Phrase constructions', 'Sentence walkthroughs']) {
    await page.getByLabel(label).uncheck();
  }
  await page.getByLabel('Chunk structure').check();
  await page.getByLabel('Particle questions').check();
}

for (const size of WIDTHS) {
  test.describe(`${size.name} width`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test.beforeEach(async ({ page }) => {
      await page.route('**/youtube-mining/jobs', (route) => route.fulfill({ json: [] }));
      await page.route('**/youtube-mining/jobs/job-1', (route) => route.fulfill({ json: readyJob }));
      await page.route('**/youtube-mining/assist-runs/job-1', (route) => route.fulfill({ status: 404, json: { detail: 'no run' } }));
    });

    test('generating extras asks once per piece and marks them ready to save', async ({ page }) => {
      const prompts = await scriptAssist(page, [{ reply: STRUCTURE_REPLY }, { reply: PARTICLES_REPLY }]);
      await openReview(page);

      await page.getByRole('button', { name: 'Generate extras' }).click();
      await expect(page.getByText(/\(1 of 2\)/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
      await expect(page.getByLabel('Chunk structure')).toBeDisabled();
      await expectNoHorizontalOverflow(page);

      await expect(page.getByText('Extras are ready and will be saved with the commit.')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: 'Regenerate extras' })).toBeEnabled();
      expect(prompts).toHaveLength(2);
      // The sentences under review are what the assistant is shown.
      expect(prompts[0]).toContain('今日は雨です');
      // A finished run leaves nothing behind to resume.
      expect(await page.evaluate((key) => localStorage.getItem(key), EXTRAS_KEY)).toBeNull();
      await expectNoHorizontalOverflow(page);
    });

    test('a piece that keeps failing stops the run, and Resume only re-asks for what is missing', async ({ page }) => {
      const prompts = await scriptAssist(page, [
        { reply: STRUCTURE_REPLY },
        { error: 'assistant unavailable' },
        { error: 'assistant unavailable' },
        { reply: PARTICLES_REPLY },
      ]);
      await openReview(page);

      await page.getByRole('button', { name: 'Generate extras' }).click();
      await expect(page.getByText(/1 of 2 parts saved/)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/assistant unavailable/)).toBeVisible();
      await expect(page.getByText('Extras are ready and will be saved with the commit.')).toHaveCount(0);
      expect(prompts).toHaveLength(3);
      // The finished structure piece is kept for the resume.
      expect(await page.evaluate((key) => Object.keys(JSON.parse(localStorage.getItem(key) ?? '{}')), EXTRAS_KEY)).toEqual(['structure:1-3']);
      await expectNoHorizontalOverflow(page);

      await page.getByRole('button', { name: 'Resume extras' }).click();
      await expect(page.getByText('Extras are ready and will be saved with the commit.')).toBeVisible({ timeout: 20_000 });
      expect(prompts).toHaveLength(4);
      expect(await page.evaluate((key) => localStorage.getItem(key), EXTRAS_KEY)).toBeNull();
    });

    test('Stop abandons the run without an error and the extras can be generated again', async ({ page }) => {
      await scriptAssist(page, []);
      await openReview(page);

      await page.getByRole('button', { name: 'Generate extras' }).click();
      await page.getByRole('button', { name: 'Stop' }).click();
      await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 10_000 });
      await expect(page.getByRole('button', { name: 'Generate extras' })).toBeEnabled();
      await expect(page.locator('.error')).toHaveCount(0);
      await expect(page.getByText('Extras are ready and will be saved with the commit.')).toHaveCount(0);
    });

    test('with every extra unticked there is nothing to generate', async ({ page }) => {
      await scriptAssist(page, []);
      await openReview(page);
      await page.getByLabel('Chunk structure').uncheck();
      await page.getByLabel('Particle questions').uncheck();
      await expect(page.getByRole('button', { name: 'Generate extras' })).toBeDisabled();
    });
  });
}
