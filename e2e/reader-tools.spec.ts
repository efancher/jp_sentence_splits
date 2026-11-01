import { expect, test, type Page } from '@playwright/test';

import { buildCheckPuzzle } from '../src/lib/earTiles';

const PIECES: [string, string, boolean][] = [
  ['私', '代名詞', false],
  ['は', '助詞/係助詞', false],
  ['猫', '名詞/普通名詞/一般', true],
  ['が', '助詞/格助詞', false],
  ['魚', '名詞/普通名詞/一般', true],
  ['を', '助詞/格助詞', false],
  ['食べ', '動詞/一般', false],
  ['ました', '助動詞', false],
  ['。', '補助記号/句点', false],
];

/** Seeds an isolated browser DB (never production/synced data) with one tokenised sentence that has audio. */
async function seed(page: Page) {
  await page.goto('/#/settings');
  await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
  await page.evaluate(async (pieces) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('satori-glossbook');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const now = new Date().toISOString();
    let cursor = 0;
    const suggestions = pieces.map(([surface, pos, content], i) => {
      const item = {
        id: `sg-${i}`, surface, start: cursor, end: cursor + surface.length, expression: surface, reading: surface, pos,
        english: surface === '猫' ? 'cat' : surface === '魚' ? 'fish' : undefined,
        source: 'morphology', selectedByDefault: content,
      };
      cursor += surface.length;
      return item;
    });
    const stores = ['books', 'sentences', 'bookSentences', 'vocabularyItems', 'sentenceVocabulary'];
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore('books').put({ id: 'book', title: '猫の物語', archived: false,
      chapters: [{ id: 'ch', title: 'Chapter', position: 0 }], collapsedChapterIds: [], createdAt: now, updatedAt: now });
    tx.objectStore('sentences').put({ id: 's-0', normalizedKey: 's-0', japanese: pieces.map((p) => p[0]).join(''),
      readingOnly: '', inlineReading: '', translation: 'I ate the cat’s fish.', targetVocabulary: [],
      vocabularySuggestions: suggestions, sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0,
      importBatchIds: [], createdAt: now, updatedAt: now });
    tx.objectStore('bookSentences').put({ id: 'bs-0', bookId: 'book', sentenceId: 's-0', position: 0,
      status: 'unstarted', addedAt: now, chapterId: 'ch' });
    for (const [id, expression, meaning] of [['v-cat', '猫', 'cat'], ['v-fish', '魚', 'fish']]) {
      tx.objectStore('vocabularyItems').put({ id, expression, reading: expression, meaning, createdAt: now, updatedAt: now });
      tx.objectStore('sentenceVocabulary').put({ id: `sv-${id}`, sentenceId: 's-0', vocabularyItemId: id,
        surfaceForm: expression, createdAt: now, updatedAt: now });
    }
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    const audioTx = db.transaction('sentenceAudio', 'readwrite');
    audioTx.objectStore('sentenceAudio').put({ id: 'audio-0', sentenceId: 's-0', sourceId: 'src', sourceSentenceId: 'ss-0',
      sourceTitle: 'Reference Video', mimeType: 'audio/mp4', durationMs: 1200, startMs: 0, endMs: 1200,
      blob: new Blob(['reference-clip'], { type: 'audio/mp4' }), importedAt: now });
    await new Promise<void>((resolve, reject) => { audioTx.oncomplete = () => resolve(); audioTx.onerror = () => reject(audioTx.error); });
    db.close();
  }, PIECES);
}

async function storedCounts(page: Page) {
  return page.evaluate(async () => {
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
    const events = await new Promise<Array<{ action: string; outcome: string; support: string; target?: { key: string; kind: string } }>>((resolve, reject) => {
      const request = db.transaction('sentenceLearningEvents').objectStore('sentenceLearningEvents').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = { reviews: await count('reviews'), studyItems: await count('studyItems'), events };
    db.close();
    return result;
  });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`reader dictation and word check work in place at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seed(page);
    await page.goto('/#/books/book/read?chapter=ch');
    await expect(page.getByRole('toolbar', { name: 'Sentence tools' })).toBeVisible();

    // Both new rail buttons are reachable. From 700px the rail is a sticky column that must fit the viewport;
    // below that it is a wrapping row after the text, in page flow, so it only has to fit the width.
    for (const name of ['Dictation', 'Ear tiles', 'Word check']) {
      const button = page.getByRole('button', { name });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeVisible();
      const box = (await button.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      if (viewport.width >= 700) expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }

    await page.getByRole('button', { name: 'Dictation' }).click();
    const blank = page.getByLabel('Sentence with a phrase blanked');
    await expect(blank).toContainText('＿＿＿');
    await expect(blank).not.toContainText('私は');
    await page.getByLabel('Missing phrase').fill('私は');
    await page.getByRole('button', { name: 'Check', exact: true }).click();
    await expect(page.getByText('✓ Matches')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`dictation-${viewport.width}.png`), fullPage: true });
    // The typed match alone records nothing.
    expect((await storedCounts(page)).events).toHaveLength(0);
    await page.getByRole('button', { name: 'Got it' }).click();

    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Word check' }).click();
    await expect(page.getByText(/What does/)).toBeVisible();
    // The question must not be answered next to it: no word-help list or translation while it is open.
    await expect(page.getByText('猫 — cat', { exact: true })).toHaveCount(0);
    await expect(page.getByText('I ate the cat’s fish.')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show meaning' }).click();
    await expect(page.getByRole('group', { name: 'Word meaning check' })).toContainText(/— (cat|fish)/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`word-check-${viewport.width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Needed help' }).click();

    await expect.poll(async () => (await storedCounts(page)).events.length).toBe(2);
    const stored = await storedCounts(page);
    // getAll() orders by primary key, not insertion, so pick each event by what it targets.
    const dictation = stored.events.find((event) => event.target?.kind === 'expression')!;
    const meaning = stored.events.find((event) => event.target?.kind === 'vocabulary')!;
    expect([dictation.action, dictation.support, dictation.outcome]).toEqual(['target_practice', 'target_masked', 'got_it']);
    expect([meaning.action, meaning.support, meaning.outcome]).toEqual(['target_practice', 'target_masked', 'needed_help']);
    expect(meaning.target!.key).toMatch(/^vocab:v-(cat|fish)$/);
    // Evidence only: no review or study item is created by either tool.
    expect(stored.reviews).toBe(0);
    expect(stored.studyItems).toBe(0);
  });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`reader ear tiles rebuild the sentence in the text at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seed(page);
    await page.goto('/#/books/book/read?chapter=ch');
    await expect(page.getByRole('toolbar', { name: 'Sentence tools' })).toBeVisible();

    await page.getByRole('button', { name: 'Ear tiles' }).click();
    const slots = page.getByLabel('Sentence so far');
    await expect(slots).toBeVisible();
    await expect(slots).not.toContainText('猫');
    // The sentence line itself is replaced by the slots while the round is open.
    await expect(page.getByRole('group', { name: 'Ear tiles' })).toBeVisible();

    const bank = page.getByLabel('Tile bank');
    // The chunker needs the tokenised suggestions, so rebuild them exactly as the seed stores them.
    let cursor = 0;
    const suggestions = PIECES.map(([surface, pos, content], i) => {
      const item = { id: `sg-${i}`, surface, start: cursor, end: cursor + surface.length, expression: surface, reading: surface, pos,
        source: 'morphology' as const, selectedByDefault: content };
      cursor += surface.length;
      return item;
    });
    const puzzle = buildCheckPuzzle({ id: 's-0', japanese: PIECES.map((p) => p[0]).join(''), vocabularySuggestions: suggestions }, 'seed')!;
    for (const text of puzzle.answer) {
      await bank.getByRole('button', { name: text, exact: true }).first().click();
    }
    await expect(page.getByText('✓ Heard it cleanly')).toBeVisible();
    await expect(slots).toContainText('猫');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`ear-tiles-${viewport.width}.png`), fullPage: true });

    // Evidence goes to the gloss log only (and only for particle fakes); nothing is rated.
    const stored = await storedCounts(page);
    expect(stored.reviews).toBe(0);
    expect(stored.studyItems).toBe(0);
  });
}

test('a planner Word check step opens the meaning check, not the walkthrough', async ({ page }) => {
  await seed(page);
  await page.goto('/#/books/book/check/s-0');
  const check = page.getByRole('group', { name: 'Word meaning check' });
  await expect(check).toBeVisible();
  await expect(page.getByRole('region', { name: 'Sentence walkthrough' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show meaning' }).click();
  await expect(check).toContainText(/— (cat|fish)/);
  await page.getByRole('button', { name: 'Got it' }).click();

  await expect.poll(async () => (await storedCounts(page)).events.length).toBe(1);
  const stored = await storedCounts(page);
  expect([stored.events[0]!.action, stored.events[0]!.support, stored.events[0]!.outcome]).toEqual(['target_practice', 'target_masked', 'got_it']);
  expect(stored.events[0]!.target!.key).toMatch(/^vocab:v-(cat|fish)$/);
  expect(stored.reviews).toBe(0);
  expect(stored.studyItems).toBe(0);
});
