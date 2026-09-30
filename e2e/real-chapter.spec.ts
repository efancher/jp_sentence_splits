import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Local-only: needs a real chapter exported to /real-chapter (mounted into the container).
const DIR = '/real-chapter';
const available = existsSync(`${DIR}/seed.json`);

test.skip(!available, 'no exported real chapter mounted at /real-chapter');

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`real chapter with audio at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    const seed = JSON.parse(readFileSync(`${DIR}/seed.json`, 'utf8'));
    const clips = seed.audio.map((row: { id: string }) => ({
      row,
      b64: readFileSync(`${DIR}/audio/${row.id}`).toString('base64'),
    }));
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));

    await page.setViewportSize(viewport);
    await page.goto('/#/settings');
    await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
    const audioSeeded = await page.evaluate(async ({ seed, clips }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('satori-glossbook');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction(['books', 'sentences', 'bookSentences', 'vocabularyItems', 'sentenceVocabulary'], 'readwrite');
      tx.objectStore('books').put(seed.book);
      for (const r of seed.sentences) tx.objectStore('sentences').put(r);
      for (const r of seed.bookSentences) tx.objectStore('bookSentences').put(r);
      for (const r of seed.vocabularyItems) tx.objectStore('vocabularyItems').put(r);
      for (const r of seed.sentenceVocabulary) tx.objectStore('sentenceVocabulary').put(r);
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      const audioSeeded = await new Promise<boolean>((resolve) => {
        try {
          const audioTx = db.transaction('sentenceAudio', 'readwrite');
          for (const clip of clips) {
            const bytes = Uint8Array.from(atob(clip.b64), (c) => c.charCodeAt(0));
            audioTx.objectStore('sentenceAudio').put({ ...clip.row, blob: new Blob([bytes], { type: clip.row.mimeType }) });
          }
          audioTx.oncomplete = () => resolve(true);
          audioTx.onerror = () => resolve(false);
          audioTx.onabort = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
      db.close();
      return audioSeeded;
    }, { seed, clips });
    console.log('AUDIO_SEEDED', audioSeeded);

    await page.goto(`/#/books/${seed.book.id}/read?chapter=${seed.chapterId}&pack=1`);
    await expect(page.getByLabel('Episode focus')).toBeVisible({ timeout: 20_000 });
    const facts = {
      rows: await page.getByRole('button', { name: 'Walk through' }).count(),
      focus: await page.getByLabel('Episode focus').innerText(),
      prompt: (await page.getByLabel('Episode pack prompt').inputValue().catch(() => '')).length,
      overflow: await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      audioButtons: await page.getByRole('button', { name: /native|play/i }).count(),
    };
    console.log('FACTS', JSON.stringify(facts));
    await page.screenshot({ path: test.info().outputPath('reader.png'), fullPage: false });

    if (existsSync(`${DIR}/reply.json`)) {
      await page.getByLabel('AI reply').fill(readFileSync(`${DIR}/reply.json`, 'utf8'));
      await page.getByRole('button', { name: 'Check and save reply' }).click();
      await expect(page.getByRole('status').filter({ hasText: /Saved:/ })).toContainText('8 focus targets saved');
      await expect(page.getByText(/1 quoted place in the reply did not match/)).toBeVisible();
      await expect(page.getByLabel('Episode focus')).toContainText('〜で');
      console.log('FOCUS AFTER REPLY', await page.getByLabel('Episode focus').innerText());
    }

    await page.getByRole('button', { name: 'Walk through' }).nth(5).click();
    const panel = page.getByRole('region', { name: 'Sentence walkthrough' });
    await expect(panel).toBeVisible();
    console.log('WALKTHROUGH', (await panel.innerText()).slice(0, 900));
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('walkthrough.png') });
    const compareButtons = panel.getByRole('button', { name: 'Compare uses' });
    if (await compareButtons.count()) {
      await compareButtons.first().click();
      const compare = panel.getByLabel(/Compare uses of/);
      await expect(compare.locator('mark').first()).toBeVisible();
      console.log('COMPARE', (await compare.innerText()).replace(/\n+/g, ' / ').slice(0, 400));
      await page.screenshot({ path: test.info().outputPath('compare.png') });
    }
    if (audioSeeded) {
      const play = panel.getByRole('button', { name: /Play native sentence recording/ });
      await play.click();
      await expect(panel.getByText(/Playing/)).toBeVisible();
      await expect(panel.getByText(/Playing/)).toHaveCount(0, { timeout: 15_000 });
      console.log('AUDIO played to the end; panel says:', await play.innerText());
    } else {
      console.log('AUDIO step skipped: this browser context refuses Blob storage');
    }
    console.log('PROBLEMS', JSON.stringify(problems));
  });
}
