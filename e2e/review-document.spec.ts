import { expect, test, type Page } from '@playwright/test';

async function seedChapterReview(page: Page) {
  await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('satori-glossbook');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const stores = ['books', 'sentences', 'bookSentences', 'analyses', 'studyItems'];
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
          chapterId: index === 30 ? 'other' : 'chapter', position: index, status: 'in_progress', addedAt: now });
        tx.objectStore('analyses').put({ sentenceId: id, chunks: [], notes: '', status: 'empty',
          formatVersion: 2, vocabularyReviewStatus: 'confirmed', vocabularySelections: [], createdAt: now, updatedAt: now });
        tx.objectStore('studyItems').put({ id: `si-${index}`, subjectType: 'sentence', subjectId: id,
          activityType: 'reading_in_context', fsrsState: fsrs(future), createdAt: now, updatedAt: now });
      }
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      db.close();
  });
}


for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`glossing page shows the chapter beside an icon toolbar at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/#/settings');
    await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
    await seedChapterReview(page);
    await page.goto('/#/books/book/analyze/s-20');
    const chapter = page.getByRole('region', { name: 'Chapter text' });
    await expect(chapter.locator('[aria-current="true"]')).toContainText('図書館で本を読みました。');
    await expect(chapter.locator('p, div.review-document-line')).toHaveCount(30);
    const toolbar = page.getByRole('toolbar', { name: 'Sentence tools' });
    for (const name of ['Previous sentence', 'Next sentence', 'Show Satori English', 'Edit reading', 'Back to book']) {
      const button = toolbar.getByRole(name === 'Back to book' ? 'link' : 'button', { name });
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute('title', name);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await toolbar.getByRole('button', { name: 'Next sentence' }).click();
    await expect(page).toHaveURL(/analyze\/s-21/);
    await expect(chapter.locator('[aria-current="true"]')).toContainText('21番目の文です。');
    await chapter.getByRole('button', { name: '図書館で本を読みました。' }).click();
    await expect(page).toHaveURL(/analyze\/s-20/);
    await page.getByLabel('Layout').selectOption('original');
    await expect(page.getByRole('toolbar', { name: 'Sentence tools' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
  });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`shadowing page shows the chapter beside an icon toolbar at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/#/settings');
    await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
    await seedChapterReview(page);
    await page.goto('/#/books/book/shadow/s-20');
    const chapter = page.getByRole('region', { name: 'Chapter text' });
    await expect(chapter.locator('[aria-current="true"]')).toContainText('図書館で本を読みました。');
    await expect(chapter.locator('.review-document-line')).toHaveCount(30);
    const toolbar = page.getByRole('toolbar', { name: 'Shadowing tools' });
    for (const name of ['Show meaning instead', 'Hide transcript', 'Delete (ad / junk)']) {
      const button = toolbar.getByRole('button', { name });
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute('title', name);
    }
    await expect(toolbar.getByRole('link', { name: 'Back to Practice' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await toolbar.getByRole('button', { name: 'Hide transcript' }).click();
    await expect(page.getByText('Audio-only practice')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Chapter text' })).toHaveCount(0);
    await toolbar.getByRole('button', { name: 'Show transcript' }).click();
    await page.getByRole('region', { name: 'Chapter text' }).getByRole('button', { name: '21番目の文です。' }).click();
    await expect(page).toHaveURL(/shadow\/s-21/);
    await page.getByLabel('Layout').selectOption('original');
    await expect(page.getByRole('toolbar', { name: 'Shadowing tools' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Hide transcript' })).toBeVisible();
  });
}
