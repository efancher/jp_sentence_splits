import { expect, test as base, type Page } from '@playwright/test';

// WebKit's ephemeral contexts cannot persist Blob data in IndexedDB (see e2e/AGENTS.md), so every
// test runs in a disk-backed profile, the same way reader-tools.spec.ts does.
const test = base.extend({
  context: async ({ playwright, browserName, baseURL, viewport, isMobile, deviceScaleFactor, hasTouch, userAgent }, provideContext, testInfo) => {
    const context = await playwright[browserName].launchPersistentContext(testInfo.outputPath('browser-profile'), {
      baseURL, viewport, isMobile, deviceScaleFactor, hasTouch, userAgent,
    });
    try {
      await provideContext(context);
    } finally {
      await context.close();
    }
  },
});

const ALIGNMENT_VERSION = 3;
const WORDS = [
  { text: '猫', start: 0, end: 0.4, phones: [] },
  { text: 'が', start: 0.4, end: 0.5, phones: [] },
  { text: '寝て', start: 0.5, end: 1.0, phones: [] },
  { text: 'います', start: 1.0, end: 1.6, phones: [] },
  { text: 'ね', start: 1.6, end: 4.0, phones: [] },
];

/** Seeds an isolated browser DB (never production/synced data): one sentence with a 4 s clip, one linked word, no alignment yet. */
async function seed(page: Page) {
  await page.goto('/#/settings');
  await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('satori-glossbook');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const now = new Date().toISOString();
    const stores = ['books', 'sentences', 'bookSentences', 'vocabularyItems', 'sentenceVocabulary', 'sentenceAudio'];
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore('books').put({ id: 'book', title: '猫の物語', archived: false,
      chapters: [{ id: 'ch', title: 'Chapter', position: 0 }], collapsedChapterIds: [], createdAt: now, updatedAt: now });
    tx.objectStore('sentences').put({ id: 's-0', normalizedKey: 's-0', japanese: '猫が寝ていますね。',
      readingOnly: '', inlineReading: '', translation: 'The cat is sleeping, you know.', targetVocabulary: [],
      vocabularySuggestions: [], sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0,
      importBatchIds: [], createdAt: now, updatedAt: now });
    tx.objectStore('bookSentences').put({ id: 'bs-0', bookId: 'book', sentenceId: 's-0', position: 0,
      status: 'unstarted', addedAt: now, chapterId: 'ch' });
    tx.objectStore('vocabularyItems').put({ id: 'v-sleep', expression: '寝る', reading: 'ねる', meaning: 'to sleep', createdAt: now, updatedAt: now });
    tx.objectStore('sentenceVocabulary').put({ id: 'sv-sleep', sentenceId: 's-0', vocabularyItemId: 'v-sleep',
      surfaceForm: '寝て', createdAt: now, updatedAt: now });
    tx.objectStore('sentenceAudio').put({ id: 'audio-0', sentenceId: 's-0', sourceId: 'src', sourceSentenceId: 'ss-0',
      sourceTitle: 'Reference Video', mimeType: 'audio/mp4', durationMs: 4000, startMs: 0, endMs: 4000,
      blob: new Blob(['reference-clip'], { type: 'audio/mp4' }), importedAt: now });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  });
}

/** What the pane's pitch chart / synced text would cache once the aligner answers. */
async function cacheAlignment(page: Page) {
  await page.evaluate(async ({ words, version }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('satori-glossbook');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('referenceAlignments', 'readwrite');
    tx.objectStore('referenceAlignments').put({ id: 'audio-0', alignmentVersion: version, computedAt: new Date().toISOString(),
      result: { durationSeconds: 4, words } });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  }, { words: WORDS, version: ALIGNMENT_VERSION });
}

async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('satori-glossbook');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const all = (store: string) => new Promise<unknown[]>((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const events = (await all('sentenceLearningEvents')) as Record<string, unknown>[];
    const result = { events, attempts: (await all('attempts')).length, reviews: (await all('reviews')).length };
    db.close();
    return result;
  });
}

test.describe('shadow pane modes', () => {
  test('opens on Full sentence, and each mode shows only its own controls', async ({ page }) => {
    await seed(page);
    await cacheAlignment(page);
    await page.goto('/#/books/book/shadow/s-0');
    await expect(page.getByText(/Loop window/)).toBeVisible();

    const mode = (name: string) => page.getByRole('group', { name: 'Shadowing mode' }).getByRole('button', { name, exact: true });
    await expect(mode('Full sentence')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Fine-tune phrase' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Rate this phrase' })).toHaveCount(0);

    await mode('Phrase').click();
    await expect(mode('Phrase')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Fine-tune phrase' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Rate this phrase' })).toBeVisible();

    // Switching away clears the phrase range, so nothing is left to rate in the other modes.
    await mode('Full sentence').click();
    await expect(page.getByRole('group', { name: 'Rate this phrase' })).toHaveCount(0);
    await expect(page.getByText(/Loop window 0\.00s–4\.00s/)).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
