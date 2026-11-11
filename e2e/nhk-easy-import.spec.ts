import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

const FEED_URL = 'https://nhkeasier.com/feed/';
const SENTENCES = ['今日は雨が降っています。', '私は本を読みます。', '明日は晴れるでしょう。'];

const feed = {
  title: 'NHK Easier',
  episodes: [
    {
      title: '雨のニュース',
      url: 'https://example.invalid/article-1.mp3',
      publishedAt: '2026-11-01T00:00:00Z',
      descriptionHtml: '<p>今日は雨が降っています。</p>',
    },
  ],
};

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function loadFeed(page: Page) {
  await page.goto('/#/import/nhk-easy');
  await page.getByPlaceholder(FEED_URL).fill(FEED_URL);
  await page.getByRole('button', { name: 'Load articles' }).click();
}

for (const size of WIDTHS) {
  test.describe(`${size.name} width`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('feed failure is shown, then a retry loads articles; a failed article import can be retried', async ({ page }) => {
      let feedCalls = 0;
      let importCalls = 0;
      await page.route('**/podcast-feed', async (route) => {
        feedCalls += 1;
        if (feedCalls === 1) { await route.fulfill({ status: 502, json: { detail: 'upstream down' } }); return; }
        await route.fulfill({ json: feed });
      });
      await page.route('**/nhk-easy/import', async (route) => {
        importCalls += 1;
        if (importCalls === 1) { await route.fulfill({ status: 500, json: { detail: 'alignment crashed' } }); return; }
        await route.fulfill({ json: {
          title: '雨のニュース',
          audioAligned: false,
          sentences: SENTENCES.map((japanese) => ({ japanese, inlineReading: japanese })),
        } });
      });

      await loadFeed(page);
      await expect(page.getByText(/Failed to load podcast feed/)).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.getByRole('button', { name: 'Load articles' }).click();
      const article = page.getByRole('button', { name: /雨のニュース/ });
      await expect(article).toBeVisible();

      await article.click();
      await expect(page.getByText(/Failed to import NHK Easy article/)).toBeVisible();
      // Still on the picker, nothing was committed.
      await expect(article).toBeEnabled();

      await article.click();
      await expect(page.getByRole('heading', { name: '雨のニュース' })).toBeVisible();
      await expect(page.getByText(/3 sentences — no usable audio/)).toBeVisible();
      await expect(page.getByPlaceholder('English translation')).toHaveCount(3);
      await expectNoHorizontalOverflow(page);
      expect(importCalls).toBe(2);
    });

    test('importing an article without audio commits sentences into a new book chapter', async ({ page }) => {
      await page.route('**/podcast-feed', (route) => route.fulfill({ json: feed }));
      await page.route('**/nhk-easy/import', (route) => route.fulfill({ json: {
        title: '雨のニュース',
        audioAligned: false,
        sentences: SENTENCES.map((japanese) => ({ japanese, inlineReading: japanese })),
      } }));

      await loadFeed(page);
      await page.getByRole('button', { name: /雨のニュース/ }).click();
      await page.getByPlaceholder('English translation').first().fill('It is raining today.');
      await page.getByRole('button', { name: 'Continue to review' }).click();

      const commit = page.getByRole('button', { name: 'Add as a new chapter' });
      await expect(commit).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Back out and forward again: cancelling must not lose the typed translation.
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByPlaceholder('English translation').first()).toHaveValue('It is raining today.');
      await page.getByRole('button', { name: 'Continue to review' }).click();

      await commit.click();
      await expect(page).toHaveURL(/#\/books\//);

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
        const sentences = await read<{ japanese: string; translation?: string }>('sentences');
        const items = await read<unknown>('studyItems');
        db.close();
        return { sentences, studyItemCount: items.length };
      });
      expect(stored.sentences.map((s) => s.japanese).sort()).toEqual([...SENTENCES].sort());
      expect(stored.sentences.find((s) => s.japanese === SENTENCES[0])?.translation).toBe('It is raining today.');
      // Importing never grades or schedules anything by itself.
      expect(stored.studyItemCount).toBe(0);
    });
  });
}
