import { expect, test as base, type Page } from '@playwright/test';

// WebKit's ephemeral contexts cannot persist Blob data in IndexedDB (see e2e/AGENTS.md), so every
// test runs in a disk-backed profile, the same way phrase-shadow.spec.ts does.
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
// 私は昨日、友達と駅で映画を見ました。 spoken over 5.4 s: the planner's rungs are
// 映画を見ました, then one more phrase per step, up to the whole sentence.
const PIECES: [string, string][] = [
  ['私', '名詞/普通名詞'], ['は', '助詞/係助詞'], ['昨日', '名詞/普通名詞'], ['、', '補助記号/読点'],
  ['友達', '名詞/普通名詞'], ['と', '助詞/格助詞'], ['駅', '名詞/普通名詞'], ['で', '助詞/格助詞'],
  ['映画', '名詞/普通名詞'], ['を', '助詞/格助詞'], ['見', '動詞/一般'], ['まし', '助動詞'], ['た', '助動詞'], ['。', '補助記号/句点'],
];
const WORDS = ([
  ['私', 0, 0.4], ['は', 0.4, 0.6], ['昨日', 0.8, 1.6], ['友達', 1.8, 2.4], ['と', 2.4, 2.6], ['駅', 2.8, 3.2],
  ['で', 3.2, 3.4], ['映画', 3.6, 4.2], ['を', 4.2, 4.4], ['見', 4.6, 4.8], ['まし', 4.8, 5.2], ['た', 5.2, 5.4],
] as const).map(([text, start, end]) => ({ text, start, end, phones: [] }));

/** Seeds an isolated browser DB (never production/synced data): one sentence with a 5.4 s clip and its cached alignment. */
async function seed(page: Page) {
  await page.goto('/#/settings');
  await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
  await page.evaluate(async ({ pieces, words, version }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('satori-glossbook');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const now = new Date().toISOString();
    let cursor = 0;
    const vocabularySuggestions = pieces.map(([surface, pos], i) => {
      const token = { id: `t${i}`, surface, start: cursor, end: cursor + surface.length, expression: surface, reading: surface, pos,
        source: 'morphology', selectedByDefault: false };
      cursor += surface.length;
      return token;
    });
    const japanese = pieces.map((piece) => piece[0]).join('');
    const stores = ['books', 'sentences', 'bookSentences', 'sentenceAudio', 'referenceAlignments'];
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore('books').put({ id: 'book', title: '映画の物語', archived: false,
      chapters: [{ id: 'ch', title: 'Chapter', position: 0 }], collapsedChapterIds: [], createdAt: now, updatedAt: now });
    tx.objectStore('sentences').put({ id: 's-0', normalizedKey: 's-0', japanese, readingOnly: '', inlineReading: '',
      translation: 'Yesterday I saw a movie at the station with a friend.', targetVocabulary: [], vocabularySuggestions,
      sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0, importBatchIds: [], createdAt: now, updatedAt: now });
    tx.objectStore('bookSentences').put({ id: 'bs-0', bookId: 'book', sentenceId: 's-0', position: 0,
      status: 'unstarted', addedAt: now, chapterId: 'ch' });
    tx.objectStore('sentenceAudio').put({ id: 'audio-0', sentenceId: 's-0', sourceId: 'src', sourceSentenceId: 'ss-0',
      sourceTitle: 'Reference Video', mimeType: 'audio/mp4', durationMs: 5400, startMs: 0, endMs: 5400,
      blob: new Blob(['reference-clip'], { type: 'audio/mp4' }), importedAt: now });
    tx.objectStore('referenceAlignments').put({ id: 'audio-0', alignmentVersion: version, computedAt: now,
      result: { durationSeconds: 5.4, words } });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  }, { pieces: PIECES, words: WORDS, version: ALIGNMENT_VERSION });
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
    const events = (await all('sentenceLearningEvents')) as Record<string, any>[];
    const result = { events, attempts: (await all('attempts')).length, reviews: (await all('reviews')).length };
    db.close();
    return result;
  });
}

/** About a quarter of runs open with a cold whole-sentence try; skip it so the walk is deterministic. */
async function skipColdTry(page: Page) {
  const cold = page.getByRole('group', { name: 'Cold try' });
  const chain = page.getByRole('group', { name: 'Chunk chain' });
  await expect(cold.or(chain)).toBeVisible();
  if (await cold.isVisible()) await cold.getByRole('button', { name: 'Skip' }).click();
}

test.describe('chunk chain on the Shadow page', () => {
  test('builds the sentence from its end, logs each rating, and grades nothing', async ({ page }) => {
    await seed(page);
    await page.goto('/#/books/book/shadow/s-0');
    await page.getByRole('button', { name: 'Chunk chain' }).click();
    await skipColdTry(page);

    const chain = page.getByRole('group', { name: 'Chunk chain' });
    await expect(chain).toContainText('映画を見ました');
    await expect(chain.getByRole('button', { name: 'Got it' })).toHaveCount(0); // the first step is never rated
    await chain.getByRole('button', { name: 'Next' }).click();

    for (const text of ['駅で映画を見ました', '友達と駅で映画を見ました', '昨日友達と駅で映画を見ました', '私は昨日友達と駅で映画を見ました']) {
      await expect(chain).toContainText(text);
      await expect(chain.getByRole('button', { name: 'Got it' })).toBeEnabled();
      await chain.getByRole('button', { name: 'Got it' }).click();
    }
    await expect(page.getByText('You got the whole sentence.')).toBeVisible();

    const { events, attempts, reviews } = await stored(page);
    const rungs = events.filter((event) => event.target?.key?.startsWith('chain-rung:'));
    const summary = events.filter((event) => event.target?.key?.startsWith('phrase-shadow:'));
    expect(rungs).toHaveLength(4);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ action: 'phrase_shadow', outcome: 'got_it', assessmentSource: 'self', rangeStartMs: 0, rangeEndMs: 5400 });
    expect(attempts).toBe(0);
    expect(reviews).toBe(0);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('moving a divider changes the steps, snapped to a word start', async ({ page }) => {
    await seed(page);
    await page.goto('/#/books/book/shadow/s-0');
    await page.getByRole('button', { name: 'Adjust steps' }).click();
    await page.getByRole('button', { name: 'Step starts at 友達' }).click();
    await page.getByRole('button', { name: 'Use these steps' }).click();
    await page.getByRole('button', { name: 'Chunk chain' }).click();
    await skipColdTry(page);

    const chain = page.getByRole('group', { name: 'Chunk chain' });
    await chain.getByRole('button', { name: 'Next' }).click();
    await expect(chain).toContainText('駅で映画を見ました');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
