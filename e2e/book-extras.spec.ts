import { expect, test } from '@playwright/test';

// Keep API mocks in control after reload, when the PWA worker would otherwise own fetches.
test.use({ serviceWorkers: 'block' });

for (const changed of [false, true]) {
  test(`finished extras on a fresh device: ${changed ? 'changed book is blocked' : 'save, retry, reload, clear'}`, async ({ page }) => {
    let deleted = false;
    await page.route('**/assist-runs/book-extras-book', async (route) => {
      if (route.request().method() === 'DELETE') { deleted = true; await route.fulfill({ status: 204 }); return; }
      await route.fulfill({ json: { status: 'done', selection: { constructions: [1, 2] }, sentenceCount: 2,
        bookSentences: [
          { handle: 1, japanese: changed ? '犬です。' : '本を読みます。', translation: '' },
          { handle: 2, japanese: '本を買いました。', translation: '' },
        ], extraReplies: { 'constructions:1-2': JSON.stringify({ version: 2, constructions: {} }) } } });
    });
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
      ['本を読みます。', '本を買いました。'].forEach((japanese, index) => {
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


    await page.goto('/#/books/book');
    const panel = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Generate extras with the assistant' }) });
    await panel.locator('summary').click();
    if (changed) {
      await expect(panel.getByText(/original sentences could not be verified/)).toBeVisible();
      await expect(panel.getByRole('button', { name: /Generate \(/ })).toBeDisabled();
      expect(await page.evaluate(() => localStorage.getItem('bookextras.snapshot.book'))).toBeNull();
      expect(deleted).toBe(false);
      return;
    }
    await expect(panel.getByText('Finished.', { exact: false })).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('bookextras.saved.book'))).toContain('constructions:1-2');
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(panel.getByText(/2 kept/)).toBeVisible();
    expect(deleted).toBe(false);
    await page.reload();
    await panel.locator('summary').click();
    await expect(panel.getByRole('button', { name: 'Save and clear' })).toBeEnabled();
    await panel.getByRole('button', { name: 'Save and clear' }).click();
    await expect(panel.getByText(/0 without · 2 already have construction layers/)).toBeVisible();
    expect(deleted).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('bookextras.snapshot.book'))).toBeNull();
  });
}
