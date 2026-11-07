import { expect, test } from '@playwright/test';

test('book, analyze, reload, backup', async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto('/#/settings');
  await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
  // Seed an isolated browser DB (the CSV upload this test used to start from was removed with the CSV importer).
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('satori-glossbook');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(['books', 'sentences', 'bookSentences'], 'readwrite');
    const now = new Date().toISOString();
    tx.objectStore('books').put({ id: 'book', title: 'little-birds', archived: false,
      chapters: [], collapsedChapterIds: [], createdAt: now, updatedAt: now });
    [
      ['ある小鳥の夫婦が、木に巣を作りました。', 'A certain little bird couple made a nest in a tree.'],
      ['暖かい春がやって来ました。', 'Warm spring has arrived.'],
      ['小鳥は卵を産みました。', 'The little bird laid eggs.'],
    ].forEach(([japanese, translation], index) => {
      const id = `s-${index}`;
      tx.objectStore('sentences').put({ id, normalizedKey: id, japanese, readingOnly: '', inlineReading: '',
        translation, targetVocabulary: [], vocabularySuggestions: [], sourceReferences: [], conflicts: [],
        firstOccurrenceIndex: index, importBatchIds: [], createdAt: now, updatedAt: now });
      tx.objectStore('bookSentences').put({ id: `bs-${index}`, bookId: 'book', sentenceId: id,
        position: index, status: 'unstarted', addedAt: now });
    });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  });

  await page.goto('/#/books/book');
  await expect(page.getByRole('button', { name: 'Edit order' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit order' }).click();
  await page.getByRole('button', { name: 'Down' }).first().click();
  await expect(page.getByText('Order updated')).toBeVisible();
  await page.getByRole('button', { name: 'Done ordering' }).click();

  await page.getByRole('button', { name: 'Analyze' }).first().click();
  await page.getByRole('button', { name: 'Apply heuristic chunking' }).click();

  const role = page.getByLabel('Role').first();
  await expect(role).toBeVisible();
  await role.selectOption('modifier/content');
  await page.getByLabel('Literal sticky English').first().fill("sticky-english");
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Saved|Saving/)).toBeVisible();

  await page.reload();
  await expect(
    page.locator('select').filter({ has: page.locator('option[value="modifier/content"]') }).first(),
  ).toHaveValue('modifier/content');
  await expect(page.locator('textarea').filter({ hasText: 'sticky-english' })).toBeVisible();

  await page.goto('/#/settings');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all data' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/backup.*\.json$/);
});
