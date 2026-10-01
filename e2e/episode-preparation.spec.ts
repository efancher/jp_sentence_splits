import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`episode preparation validates a pasted reply and survives reload at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
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

    await page.goto('/#/books/book/read?chapter=chapter');
    await page.getByText(/Episode preparation/).click();
    await expect(page.getByLabel('Episode pack prompt')).toHaveValue(/S2: 本を買いました。/);
    const reply = JSON.stringify({ targets: [
      { kind: 'expression', label: '本を', reason: 'Object marking.', occurrences: [{ sentence: 'S1', text: '本を' }, { sentence: 'S2', text: '本を' }] },
      { kind: 'expression', label: '作り話', reason: 'Invented.', occurrences: [{ sentence: 'S1', text: '作り話' }] },
    ] });
    await page.getByLabel('AI reply').fill(reply);
    await page.getByRole('button', { name: 'Check and save reply' }).click();
    await expect(page.getByText(/some rejected, listed below/)).toBeVisible();
    await expect(page.getByText(/No quoted occurrence matched a real sentence/)).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('preparation.png'), fullPage: true });

    await page.reload();
    await page.getByText(/Episode preparation \(optional\) — partial/).click();
    await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
    await expect(page.getByText('本を', { exact: true }).first()).toBeVisible();
  });
}
