import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`in-sentence practice and compare uses are recorded without reviews at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/#/settings');
    await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
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
          translation: `Translation ${index}.`, targetVocabulary: [],
          vocabularySuggestions: [{ id: `v-${index}`, surface: index ? '買い' : '読み', start: 2, end: 4,
            expression: index ? '買う' : '読む', reading: index ? 'かう' : 'よむ', pos: '動詞',
            english: index ? 'to buy' : 'to read', source: 'morphology', selectedByDefault: true }],
          sourceReferences: [], conflicts: [],
          firstOccurrenceIndex: index, importBatchIds: [], createdAt: now, updatedAt: now });
        tx.objectStore('bookSentences').put({ id: `bs-${index}`, bookId: 'book', sentenceId: id,
          position: index, status: 'unstarted', addedAt: now, chapterId: 'chapter' });
      });
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      db.close();
    });

    await page.goto('/#/books/book/read?chapter=chapter');
    await page.getByText(/Episode preparation/).click();
    await page.getByLabel('AI reply').fill(JSON.stringify({ targets: [
      { kind: 'expression', label: '本を', reason: 'Marks the thing being read or bought.',
        occurrences: [{ sentence: 'S1', text: '本を' }, { sentence: 'S2', text: '本を' }] },
    ] }));
    await page.getByRole('button', { name: 'Check and save reply' }).click();
    await expect(page.getByLabel('Episode focus')).toContainText('本を');

    await page.getByRole('button', { name: 'Walk through' }).first().click();
    const panel = page.getByRole('region', { name: 'Sentence walkthrough' });
    await expect(panel.getByLabel('Words in this sentence').first()).toContainText('読む (よむ) — to read');
    await panel.getByRole('button', { name: 'Practise this' }).click();
    await expect(panel.getByText(/Before you look/)).toBeVisible();
    await expect(panel.getByText('Marks the thing being read or bought.')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Show explanation' }).click();
    await expect(panel.getByText(/Marks the thing being read or bought\./)).toBeVisible();
    await panel.getByRole('button', { name: 'I had it' }).click();
    await expect(panel.getByText(/review schedule is unchanged/)).toBeVisible();

    await panel.getByRole('button', { name: 'Compare uses' }).click();
    const compare = panel.getByLabel('Compare uses of 本を');
    await expect(compare).toContainText('本を買いました。');
    await expect(compare.locator('mark').first()).toHaveText('本を');
    // Aids for sentences whose vocabulary may be unfamiliar: glosses shown, translation on request.
    await expect(compare.getByLabel('Words in this sentence')).toHaveCount(2);
    await expect(compare).toContainText('買う (かう) — to buy');
    await expect(compare).not.toContainText('Translation 1.');
    await compare.getByRole('button', { name: 'Show translation' }).last().click();
    await expect(compare).toContainText('Translation 1.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('lesson.png'), fullPage: true });

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
      const result = { events: await count('sentenceLearningEvents'), reviews: await count('reviews'), items: await count('studyItems') };
      db.close();
      return result;
    });
    expect(counts.events).toBe(3);
    expect(counts.reviews).toBe(0);
    expect(counts.items).toBe(0);

    await page.reload();
    await page.getByRole('button', { name: 'Walk through' }).first().click();
    await expect(page.getByRole('region', { name: 'Sentence walkthrough' })).toContainText(/practised 1× \(1 got it\) · compared with 1 other use/);
  });
}
