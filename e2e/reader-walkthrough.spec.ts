import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`reader walkthrough is ungated and keeps audio/quiet controls at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/#/settings');
    await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
    // Seed an isolated browser DB, never production/synced data.
    const audioSeeded = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('satori-glossbook');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const stores = ['books', 'sentences', 'bookSentences', 'vocabularyItems', 'sentenceVocabulary'];
      const tx = db.transaction(stores, 'readwrite');
      const now = new Date().toISOString();
      tx.objectStore('books').put({ id: 'book', title: '本の物語', archived: false,
        chapters: [], collapsedChapterIds: [], createdAt: now, updatedAt: now });
      const lines = ['本を読みます。', '本を買いました。', '電気を消しました。'];
      lines.forEach((japanese, index) => {
        const id = `s-${index}`;
        tx.objectStore('sentences').put({ id, normalizedKey: id, japanese, readingOnly: '', inlineReading: '',
          translation: `Natural translation ${index}.`, targetVocabulary: [], vocabularySuggestions: [],
          sourceReferences: [], conflicts: [], firstOccurrenceIndex: index, importBatchIds: [],
          createdAt: now, updatedAt: now });
        tx.objectStore('bookSentences').put({ id: `bs-${index}`, bookId: 'book', sentenceId: id,
          position: index, status: 'unstarted', addedAt: now });
      });
      tx.objectStore('vocabularyItems').put({ id: 'word', expression: '本', reading: 'ほん', meaning: 'book', createdAt: now, updatedAt: now });
      ['s-0', 's-1'].forEach((sentenceId) => tx.objectStore('sentenceVocabulary').put({
        id: `sv-${sentenceId}`, sentenceId, vocabularyItemId: 'word', surfaceForm: '本', createdAt: now, updatedAt: now }));
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      // WebKit's ephemeral test contexts may refuse Blob storage; report it rather than fail the seed.
      const audioSeeded = await new Promise<boolean>((resolve) => {
        try {
          const audioTx = db.transaction('sentenceAudio', 'readwrite');
          audioTx.objectStore('sentenceAudio').put({ id: 'audio-0', sentenceId: 's-0', sourceId: 'src', sourceSentenceId: 'ss-0',
            sourceTitle: 'Reference Video', mimeType: 'audio/mp4', durationMs: 1200, startMs: 0, endMs: 1200,
            blob: new Blob(['reference-clip'], { type: 'audio/mp4' }), importedAt: now });
          audioTx.oncomplete = () => resolve(true);
          audioTx.onerror = () => resolve(false);
          audioTx.onabort = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
      db.close();
      return audioSeeded;
    });

    await page.goto('/#/books/book/read');
    await expect(page.getByText('本を読みます。').first()).toBeVisible();
    await page.getByRole('button', { name: 'Walk through' }).first().click();

    const panel = page.getByRole('region', { name: 'Sentence walkthrough' });
    await expect(panel).toContainText('Automatic draft');
    await expect(panel).toContainText('Step 1 of');
    await expect(panel).toContainText('not assessed yet');
    await expect(panel).toContainText('Worth noticing here');
    if (audioSeeded) {
      await expect(panel.getByRole('button', { name: 'Adjust' })).toBeVisible();
    } else {
      await expect(panel).toContainText('No native audio for this sentence');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('walkthrough.png'), fullPage: true });

    while (await panel.getByRole('button', { name: /^(Continue|Finish)$/ }).isEnabled()) {
      await panel.getByRole('button', { name: /^(Continue|Finish)$/ }).click();
    }
    await panel.getByRole('button', { name: 'Show natural translation' }).click();
    await expect(panel).toContainText('Natural translation 0.');

    await panel.getByLabel(/Can.t speak right now/).click();
    await expect(panel.getByLabel(/Can.t speak right now/)).toBeChecked();
    await page.reload();
    await page.getByRole('button', { name: 'Walk through' }).first().click();
    await expect(page.getByRole('region', { name: 'Sentence walkthrough' }).getByLabel(/Can.t speak right now/)).toBeChecked();

    // Walking through wrote nothing that could schedule or grade.
    const counts = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('satori-glossbook');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const count = (store: string) => new Promise<number>((resolve) => {
        const request = db.transaction(store).objectStore(store).count();
        request.onsuccess = () => resolve(request.result);
      });
      const result = { studyItems: await count('studyItems'), reviews: await count('reviews') };
      db.close();
      return result;
    });
    expect(counts).toEqual({ studyItems: 0, reviews: 0 });

    // A sentence without native audio says so instead of offering a fallback voice.
    await page.getByRole('button', { name: 'Back to reading' }).click();
    await page.getByRole('button', { name: 'Walk through' }).nth(2).click();
    await expect(page.getByText(/No native audio for this sentence/)).toBeVisible();
  });
}
