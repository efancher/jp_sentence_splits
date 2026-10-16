import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
for (const width of [390, 1280]) {
  test(`clause preview highlights a sub-chunk span and stays ungraded at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/settings');
    await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
    // Seed an isolated browser DB, never production/synced data.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('satori-glossbook');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction(['books', 'sentences', 'bookSentences'], 'readwrite');
      const now = new Date().toISOString();
      tx.objectStore('books').put({ id: 'book', title: '本の物語', archived: false,
        chapters: [{ id: 'chapter', title: '第一章', position: 0 }], collapsedChapterIds: [], createdAt: now, updatedAt: now });
      ['最初に飛び立ったひなは、近くの木の枝に止まっていました。', '本を買いました。', 'みなさん、こんにちは。', 'カナリア諸島は、木がたくさんある場所や、木があまりなくて岩だけの場所、そして砂漠もあるので、とても興味深いです。'].forEach((japanese, index) => {
        const id = `s-${index}`;
        tx.objectStore('sentences').put({ id, normalizedKey: id, japanese, readingOnly: '', inlineReading: '',
          translation: '', targetVocabulary: [], vocabularySuggestions: [], sourceReferences: [], conflicts: [],
          firstOccurrenceIndex: index, importBatchIds: [], createdAt: now, updatedAt: now });
        tx.objectStore('bookSentences').put({ id: `bs-${index}`, bookId: 'book', sentenceId: id,
          position: index, status: 'unstarted', addedAt: now, chapterId: 'chapter' });
      });
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      db.close();
    });


    await page.goto('/#/books/book/read?chapter=chapter');
    await page.getByRole('button', { name: 'Walk through', exact: true }).first().click();
    const walkthrough = page.getByRole('region', { name: 'Sentence walkthrough' });
    const preview = walkthrough.locator('details').filter({ has: page.locator('summary', { hasText: 'Try a clause question' }) });
    await preview.locator('summary').click();
    await expect(preview.locator('mark')).toHaveText('飛び立った');
    const counts = () => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => { const req = indexedDB.open('satori-glossbook'); req.onsuccess = () => resolve(req.result); });
      const stores = ['reviews', 'glossDecisions', 'studyItems'];
      const tx = db.transaction(stores, 'readonly');
      const result = await Promise.all(stores.map((name) => new Promise<number>((resolve) => {
        const req = tx.objectStore(name).count(); req.onsuccess = () => resolve(req.result);
      })));
      db.close(); return result;
    });
    const before = await counts();
    await preview.getByRole('button', { name: '枝', exact: true }).click();
    await preview.getByRole('button', { name: 'Show explanation' }).click();
    await expect(preview.getByText('Draft answer:', { exact: false })).toContainText('ひな');
    await preview.getByRole('button', { name: 'Another answer works' }).click();
    await expect(preview.getByText('Feedback saved on this device.')).toBeVisible();
    expect(await counts()).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('clause-preview.png'), fullPage: true });
    await page.reload();
    await page.getByRole('button', { name: 'Walk through', exact: true }).first().click();
    await preview.locator('summary').click();
    await preview.getByRole('button', { name: 'Show explanation' }).click();
    await expect(preview.getByRole('button', { name: 'Another answer works' })).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/#/books/book/learn/s-1');
    await expect(page.getByText('Upgraded question not prepared yet')).toBeVisible();
    await page.goto('/#/books/book/learn/s-2');
    await expect(page.getByText('Reviewed — no upgraded question yet')).toBeVisible();
    await page.goto('/#/books/book/learn/s-3');
    await preview.locator('summary').click();
    await preview.getByRole('button', { name: 'とても興味深いです', exact: true }).click();
    await preview.getByRole('button', { name: 'Show explanation' }).click();
    await expect(preview.getByText('Draft answer:', { exact: false })).toContainText('とても興味深いです');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await counts()).toEqual(before);
  });
}
