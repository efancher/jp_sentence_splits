import { expect, test, type Page } from '@playwright/test';

async function seedChapterReview(page: Page, dueActivities: string[]) {
  await page.evaluate(async (dueActivities: string[]) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('satori-glossbook');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const stores = ['books', 'sentences', 'bookSentences', 'analyses', 'vocabularyItems', 'sentenceVocabulary', 'studyItems'];
      const tx = db.transaction(stores, 'readwrite');
      const now = new Date().toISOString();
      const future = new Date(Date.now() + 86400000).toISOString();
      const fsrs = (due: string) => ({ due, stability: 1, difficulty: 1, elapsedDays: 0,
        scheduledDays: 1, learningSteps: 0, reps: 1, lapses: 0, state: 'review' });
      tx.objectStore('books').put({ id: 'book', title: '本の物語', archived: false,
        chapters: [{ id: 'chapter', title: '第一章', position: 0 }, { id: 'other', title: '第二章', position: 1 }],
        collapsedChapterIds: [], createdAt: now, updatedAt: now });
      for (let index = 0; index < 31; index++) {
        const id = `s-${index}`;
        const japanese = index === 20 ? '図書館で本を読みました。' : index === 0 ? '昨日も本を読みました。'
          : index === 30 ? '別の章の答え。' : `${index}番目の文です。`;
        tx.objectStore('sentences').put({ id, normalizedKey: id, japanese, readingOnly: 'secret reading',
          inlineReading: '本[ほん]', translation: 'I read a book in the library.', targetVocabulary: [],
          vocabularySuggestions: [], sourceReferences: [], conflicts: [], firstOccurrenceIndex: index,
          importBatchIds: [], createdAt: now, updatedAt: now });
        tx.objectStore('bookSentences').put({ id: `bs-${index}`, bookId: 'book', sentenceId: id,
          chapterId: index === 30 ? 'other' : 'chapter', position: index, status: 'unstarted', addedAt: now });
        tx.objectStore('analyses').put({ sentenceId: id, chunks: [], notes: '', status: 'empty',
          formatVersion: 2, vocabularyReviewStatus: 'confirmed', vocabularySelections: [], createdAt: now, updatedAt: now });
        tx.objectStore('studyItems').put({ id: `si-${index}`, subjectType: 'sentence', subjectId: id,
          activityType: 'reading_in_context', fsrsState: fsrs(future), createdAt: now, updatedAt: now });
      }
      tx.objectStore('vocabularyItems').put({ id: 'word', expression: '本', reading: 'ほん', meaning: 'book', createdAt: now, updatedAt: now });
      tx.objectStore('sentenceVocabulary').put({ id: 'sv', sentenceId: 's-20', vocabularyItemId: 'word', surfaceForm: '本', createdAt: now, updatedAt: now });
      for (const activityType of ['reading_retrieval', 'cloze', 'reading_production']) {
        tx.objectStore('studyItems').put({ id: `word-${activityType}`, subjectType: 'vocabularyItem', subjectId: 'word', activityType,
          fsrsState: fsrs(dueActivities.includes(activityType) ? '2026-01-01T00:00:00.000Z' : future), createdAt: now, updatedAt: now });
      }
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      db.close();
  }, dueActivities);
}


for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`chapter cloze stays navigable and grades once at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/#/settings');
    await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
    // Seed an isolated browser DB, never production/synced data.
    await seedChapterReview(page, ['cloze']);
    await page.goto('/#/books/book/review');
    const layout = page.getByRole('combobox', { name: 'Review layout' });
    await layout.selectOption('original');
    await expect(page.getByRole('region', { name: 'Chapter text' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reveal word', exact: true })).toBeVisible();
    await page.reload();
    await expect(layout).toHaveValue('original');
    await layout.selectOption('chapter');
    await expect(page.getByText('第一章', { exact: true })).toBeVisible();
    const chapter = page.getByRole('region', { name: 'Chapter text' });
    await expect(chapter.locator('p')).toHaveCount(30);
    await expect(chapter).not.toContainText('本');
    await expect(page.getByText('本の物語 · Review', { exact: true })).toHaveCount(0);
    await expect(chapter).not.toContainText('secret reading');
    await expect(chapter).not.toContainText('別の章');
    const active = chapter.locator('[aria-current="true"]');
    const centered = () => chapter.evaluate((el) => {
      const target = el.querySelector('[aria-current="true"]')!.getBoundingClientRect();
      const bounds = el.getBoundingClientRect();
      return target.top >= bounds.top && target.bottom <= bounds.bottom;
    });
    await expect.poll(centered).toBe(true);
    await chapter.evaluate((el) => { el.scrollTop = 0; });
    await page.getByRole('button', { name: 'Back to target' }).click();
    await expect.poll(centered).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByText('Recall the missing word.', { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('chapter-cloze.png'), fullPage: true });
    await page.getByRole('button', { name: 'Reveal word', exact: true }).click();
    await expect(active).toContainText('図書館で本を読みました。');
    await layout.selectOption('original');
    await expect(page.getByRole('region', { name: 'Chapter text' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reveal word', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Good', exact: true })).toBeVisible();
    await layout.selectOption('chapter');
    await expect(active).toContainText('図書館で本を読みました。');
    await page.getByRole('button', { name: 'Good', exact: true }).click();
    await expect.poll(async () => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open('satori-glossbook'); request.onsuccess = () => resolve(request.result);
      });
      const count = await new Promise<number>((resolve) => {
        const request = db.transaction('reviews').objectStore('reviews').count(); request.onsuccess = () => resolve(request.result);
      });
      db.close();
      return count;
    })).toBe(1);
    // Presentation evidence is on that one review: final layout, document size, and the switch.
    const presentation = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open('satori-glossbook'); request.onsuccess = () => resolve(request.result);
      });
      const rows = await new Promise<Array<{ presentation?: unknown }>>((resolve) => {
        const request = db.transaction('reviews').objectStore('reviews').getAll(); request.onsuccess = () => resolve(request.result);
      });
      db.close();
      return rows[0]?.presentation;
    });
    expect(presentation).toMatchObject({ layout: 'chapter', layoutSwitched: true });
    expect((presentation as { documentSentenceCount: number }).documentSentenceCount).toBeGreaterThan(1);
  });
}

test('typed-reading card uses the chapter layout, like the other word cards', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
  await seedChapterReview(page, ['reading_production']);
  await page.goto('/#/books/book/review');
  await expect(page.getByLabel('Type the reading')).toBeVisible();
  const chapter = page.getByRole('region', { name: 'Chapter text' });
  await expect(chapter.locator('p')).toHaveCount(30);
  await expect(chapter).not.toContainText('secret reading');
  await expect(chapter.locator('[aria-current="true"]')).toContainText('図書館で本を読みました。');
  const layout = page.getByRole('combobox', { name: 'Review layout' });
  await layout.selectOption('original');
  await expect(page.getByRole('region', { name: 'Chapter text' })).toHaveCount(0);
  await expect(page.getByLabel('Type the reading')).toBeVisible();
});
