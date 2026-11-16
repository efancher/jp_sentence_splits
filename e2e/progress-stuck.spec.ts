import { expect, test, type Page } from '@playwright/test';

/** One met sentence with no audio in a studied book, and one met sentence only in a suspended book. */
async function seedStuck(page: Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('satori-glossbook');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(['books', 'sentences', 'bookSentences'], 'readwrite');
    const now = new Date().toISOString();
    const book = (id: string, title: string, extra = {}) =>
      tx.objectStore('books').put({ id, title, archived: false, chapters: [], collapsedChapterIds: [], createdAt: now, updatedAt: now, ...extra });
    book('studied', '勉強中の本');
    book('shelved', '休止中の本', { suspendedAt: now });
    const sentence = (id: string, japanese: string, bookId: string) => {
      tx.objectStore('sentences').put({ id, normalizedKey: id, japanese, readingOnly: '', inlineReading: '',
        translation: 't', targetVocabulary: [], vocabularySuggestions: [], sourceReferences: [], conflicts: [],
        firstOccurrenceIndex: 0, importBatchIds: [], createdAt: now, updatedAt: now });
      tx.objectStore('bookSentences').put({ id: `bs-${id}`, bookId, sentenceId: id, position: 0, status: 'in_progress', addedAt: now });
    };
    sentence('s-silent', '音声のない文です。', 'studied');
    sentence('s-shelved', '休止中の本の文です。', 'shelved');
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`What's stuck names the blocking requirement with example sentences at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/#/settings');
    await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
    await seedStuck(page);
    await page.goto('/#/progress');

    const panel = page.locator('section', { has: page.getByRole('heading', { name: "What's stuck" }) });
    await expect(panel).toContainText("Of the 2 sentences you've met");
    const row = (label: string) => panel.locator('.row', { hasText: label });
    await expect(row('No native audio').locator('strong')).toHaveText('1');
    await expect(row('Only in shelved books').locator('strong')).toHaveText('1');
    await expect(row('No word analysis').locator('strong')).toHaveText('0');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await panel.getByRole('link', { name: '音声のない文です。' }).click();
    await expect(page).toHaveURL(/sentences\/s-silent\/deep-dive/);
  });
}
