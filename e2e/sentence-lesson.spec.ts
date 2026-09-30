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
    // Default word help shows only words new to the learner, with an override.
    const firstRow = page.locator('.panel').filter({ hasText: '本を読みます。' }).last();
    await expect(firstRow.getByLabel('Words in this sentence')).toContainText('読む (よむ) — to read');
    await expect(firstRow).toContainText('1 of 1 words are new to you');
    // All words are new here, so the translation shows by default and can be hidden.
    await expect(firstRow.getByRole('button', { name: 'Hide translation' })).toBeVisible();
    await firstRow.getByRole('button', { name: 'Hide translation' }).click();
    await expect(firstRow.getByRole('button', { name: 'Show translation' })).toBeVisible();
    await firstRow.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(firstRow.getByLabel('Words in this sentence')).toHaveCount(0);
    await firstRow.getByRole('button', { name: 'Reset' }).click();
    await expect(firstRow.getByLabel('Words in this sentence')).toHaveCount(1);
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
    // Help level: minimal hides role/gloss/explanation until asked, and the choice persists.
    await panel.getByLabel('Help level').selectOption('minimal');
    await expect(panel.getByRole('button', { name: 'Show role' })).toBeVisible();
    await panel.getByRole('button', { name: 'Show role' }).click();
    await expect(panel.getByRole('button', { name: 'Explain this role' })).toBeVisible();
    await panel.getByLabel('Help level').selectOption('full');
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
    // Fill the gap: the occurrence is masked until the learner asks to see it.
    await panel.getByRole('button', { name: 'Fill the gap' }).click();
    const gapBox = panel.getByLabel('Fill the gap for 本を');
    await expect(gapBox).toContainText('＿＿＿読みます。');
    await expect(gapBox.getByText('本を', { exact: true })).toHaveCount(0);
    await gapBox.getByLabel('Your answer for the gap').fill('本を');
    await gapBox.getByRole('button', { name: 'Show the answer' }).click();
    await expect(gapBox).toContainText('Answer:');
    await gapBox.getByRole('button', { name: 'I had it before looking' }).click();
    await expect(panel.getByText(/Noted as gap practice/)).toBeVisible();
    // Content reports: flagged for repair, never a failed practice.
    await panel.getByRole('button', { name: 'Practise this' }).click();
    await panel.getByRole('button', { name: 'Show explanation' }).click();
    await panel.getByLabel(/Your own answer/).fill('it marks the object');
    await panel.getByRole('button', { name: 'Another answer works' }).click();
    await expect(panel.getByText(/flagged for repair/)).toBeVisible();
    await expect(page.getByLabel('Flagged prompts')).toContainText('it marks the object');
    // Gist check: translation stays hidden until asked; logged with no target.
    const nextButton = panel.locator('button.primary');
    for (let i = 0; i < 12 && !(await panel.getByRole('button', { name: 'Check my understanding' }).isVisible()); i++) await nextButton.click();
    await panel.getByRole('button', { name: 'Check my understanding' }).click();
    await expect(panel.getByText('Translation 0.')).toHaveCount(0);
    await panel.getByLabel('Your understanding').fill('reading a book');
    await panel.getByRole('button', { name: 'Reveal the translation' }).click();
    await expect(panel.getByText('Translation 0.')).toBeVisible();
    await panel.getByRole('button', { name: 'I had the gist' }).click();
    await expect(panel.getByText(/says nothing about any single word/)).toBeVisible();
    // Say it in Japanese: the Japanese stays hidden until the model is requested; the self-check is recorded, not graded.
    await panel.getByRole('button', { name: 'Say it in Japanese' }).click();
    const express = page.getByRole('region', { name: 'Say it in Japanese' });
    await expect(express).toContainText('Translation 0.');
    await expect(express).not.toContainText('本を読みます。');
    await express.getByRole('button', { name: /Give me a frame/ }).click();
    await express.getByRole('button', { name: /Show the words/ }).click();
    await expect(express.getByLabel('Word bank')).toContainText('読む');
    await express.getByLabel('Your Japanese').fill('本を読む');
    await express.getByRole('button', { name: 'Show the model and check' }).click();
    await expect(express).toContainText('本を読みます。');
    await express.getByRole('button', { name: 'Record my attempt' }).click();
    await expect(express).toContainText('Still to carry next time');
    await express.getByRole('button', { name: 'Back to the walkthrough' }).click();
    await expect(page.getByLabel('Sentence journey').first()).toContainText('Sentence journey: 29%');
    await expect(page.getByLabel('Sentence journey').first()).toContainText('Structure: 1/1 independent, 1/1 with support');
    await expect(page.getByLabel('Sentence journey').first()).toContainText('reading alone cannot reach 100%');
    await expect(page.getByLabel('Sentence progress').first()).toContainText('walked through · 1 target practised · written 1× · gist: had it');
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
    expect(counts.events).toBe(8);
    expect(counts.reviews).toBe(0);
    expect(counts.items).toBe(0);

    await page.reload();
    await page.getByRole('button', { name: 'Walk through' }).first().click();
    await expect(page.getByRole('region', { name: 'Sentence walkthrough' })).toContainText(/practised 2× \(2 got it, 1 with the word hidden\) · compared with 1 other use/);
  });
}
