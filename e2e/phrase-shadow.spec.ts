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

test.describe('phrase shadowing on the Shadow page', () => {
  test('suggests the weakest word\'s phrase once aligned, and logs a self-rated pass without grading anything', async ({ page }) => {
    await seed(page);
    await page.goto('/#/books/book/shadow/s-0');
    await expect(page.getByText(/Loop window/)).toBeVisible();
    await expect(page.getByText(/Suggested phrase/)).toHaveCount(0);

    // A raw IndexedDB write is invisible to Dexie's live queries, so reload to open the pane on a cached alignment
    // (the "appears as soon as it lands" path, which goes through Dexie, is covered in tests/shadowPagePhrase.test.tsx).
    await cacheAlignment(page);
    await page.reload();
    await expect(page.getByText('Suggested phrase (covers 寝る):')).toBeVisible();

    await page.getByRole('button', { name: 'Use this phrase' }).click();
    const rating = page.getByRole('group', { name: 'Rate this phrase' });
    await expect(rating).toContainText('寝ています');
    await expect(rating).toContainText('0.5–1.6s');

    await rating.getByRole('button', { name: 'Got it' }).click();
    await expect(rating).toContainText('Logged “Got it”');

    const { events, attempts, reviews } = await stored(page);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'phrase_shadow', outcome: 'got_it', assessmentSource: 'self',
      sentenceId: 's-0', rangeStartMs: 500, rangeEndMs: 1600, target: { label: '寝ています' } });
    expect(attempts).toBe(0);
    expect(reviews).toBe(0);

    // No horizontal overflow from the new rows at this viewport.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('without an alignment there is no suggestion and no rating row until a span is set', async ({ page }) => {
    await seed(page);
    await page.goto('/#/books/book/shadow/s-0');
    await expect(page.getByText(/Loop window/)).toBeVisible();
    await expect(page.getByText(/Suggested phrase/)).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Rate this phrase' })).toHaveCount(0);
    expect((await stored(page)).events).toHaveLength(0);
  });
});
