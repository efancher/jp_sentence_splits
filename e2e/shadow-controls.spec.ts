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

test.use({ serviceWorkers: 'block' });

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

const LAYOUT_KEY = 'satori-glossbook:shadow-layout';
const GAP_KEY = 'satori-glossbook:shadow-loop-gap-ms';
const LEAD_IN_KEY = 'satori-glossbook:shadow-loop-lead-in-ms';

/** Seeds an isolated browser DB: one sentence with a real, seekable 4 s silent WAV clip. */
async function seed(page: Page) {
  await page.goto('/#/settings');
  await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
  await page.evaluate(async () => {
    const sampleRate = 8000;
    const samples = sampleRate * 4;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true);

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('satori-glossbook');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const now = new Date().toISOString();
    const stores = ['books', 'sentences', 'bookSentences', 'sentenceAudio'];
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore('books').put({ id: 'book', title: '猫の物語', archived: false,
      chapters: [{ id: 'ch', title: 'Chapter', position: 0 }], collapsedChapterIds: [], createdAt: now, updatedAt: now });
    tx.objectStore('sentences').put({ id: 's-0', normalizedKey: 's-0', japanese: '猫が寝ていますね。',
      readingOnly: '', inlineReading: '', translation: 'The cat is sleeping, you know.', targetVocabulary: [],
      vocabularySuggestions: [], sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0,
      importBatchIds: [], createdAt: now, updatedAt: now });
    tx.objectStore('bookSentences').put({ id: 'bs-0', bookId: 'book', sentenceId: 's-0', position: 0,
      status: 'unstarted', addedAt: now, chapterId: 'ch' });
    tx.objectStore('sentenceAudio').put({ id: 'audio-0', sentenceId: 's-0', sourceId: 'src', sourceSentenceId: 'ss-0',
      sourceTitle: 'Reference Video', mimeType: 'audio/wav', durationMs: 4000, startMs: 0, endMs: 4000,
      blob: new Blob([buffer], { type: 'audio/wav' }), importedAt: now });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  });
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
    const result = { attempts: await count('attempts'), reviews: await count('reviews'), studyItems: await count('studyItems') };
    db.close();
    return result;
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Open the Shadow page in the "Original" layout, where the mark/target buttons are shown. */
async function openShadow(page: Page) {
  await seed(page);
  await page.evaluate((key) => localStorage.setItem(key, 'original'), LAYOUT_KEY);
  await page.goto('/#/books/book/shadow/s-0');
  await expect(page.getByText(/Loop window/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark start' })).toBeVisible();
}

/** Park the reference audio at `seconds` so Mark start/end reads that position. */
async function seekReference(page: Page, seconds: number) {
  await page.evaluate(async (target) => {
    const audio = document.querySelector<HTMLAudioElement>('audio[aria-label="Reference audio"]')!;
    if (audio.readyState < 1) await new Promise((resolve) => audio.addEventListener('loadedmetadata', resolve, { once: true }));
    audio.currentTime = target;
  }, seconds);
}

for (const size of WIDTHS) {
  test.describe(`${size.name} width`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('marking a start and end shows the target, which can be cleared', async ({ page }) => {
      await openShadow(page);
      await expect(page.getByText(/Target:/)).toHaveCount(0);

      await seekReference(page, 1);
      await page.getByRole('button', { name: 'Mark start' }).click();
      // A lone start is an empty range: shown, but it cannot be looped.
      await expect(page.getByText('Target: 1.0s–1.0s')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Loop target' })).toBeDisabled();

      await seekReference(page, 2.5);
      await page.getByRole('button', { name: 'Mark end' }).click();
      await expect(page.getByText('Target: 1.0s–2.5s')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Loop target' })).toBeEnabled();
      await expectNoHorizontalOverflow(page);

      // An end before the start is shown but not loopable.
      await seekReference(page, 0.5);
      await page.getByRole('button', { name: 'Mark end' }).click();
      await expect(page.getByText('Target: 1.0s–0.5s')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Loop target' })).toBeDisabled();

      await page.getByRole('button', { name: 'Clear target' }).click();
      await expect(page.getByText(/Target:/)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Loop target' })).toHaveCount(0);

      // Marking is practice scaffolding only: nothing is graded or scheduled.
      expect(await storedCounts(page)).toEqual({ attempts: 0, reviews: 0, studyItems: 0 });
    });

    test('the loop window sliders clamp, persist and reset', async ({ page }) => {
      await openShadow(page);
      await page.getByText(/Loop window/).click();

      const start = page.getByLabel('Loop start');
      const end = page.getByLabel('Loop end');
      await expect(page.getByRole('button', { name: 'Whole sentence' })).toHaveCount(0);

      await start.fill('1000');
      await end.fill('3000');
      await expect(page.getByText('Loop window 1.00s–3.00s')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Whole sentence' })).toBeVisible();

      // The window can never collapse below its minimum length.
      await start.fill('3000');
      const startMs = Number(await start.inputValue());
      const endMs = Number(await end.inputValue());
      expect(endMs - startMs).toBeGreaterThanOrEqual(200);

      await page.getByLabel('Pause between loops').fill('1500');
      await page.getByLabel('Lead-in before each rep').fill('800');
      await page.getByLabel('Loop speed').fill('0.75');
      await expect(page.getByText(/1\.5s pause · 0\.8s lead-in · 0\.75× speed/)).toBeVisible();
      await expectNoHorizontalOverflow(page);

      expect(await page.evaluate(([gap, lead]) => [localStorage.getItem(gap), localStorage.getItem(lead)], [GAP_KEY, LEAD_IN_KEY]))
        .toEqual(['1500', '800']);

      // Pause and lead-in are remembered across visits; the marked window itself is per visit.
      await page.reload();
      await expect(page.getByText(/1\.5s pause · 0\.8s lead-in/)).toBeVisible();
      await expect(page.getByText(/Loop window 0\.00s–4\.00s/)).toBeVisible();

      await page.getByText(/Loop window/).click();
      await page.getByLabel('Loop start').fill('1000');
      await page.getByRole('button', { name: 'Whole sentence' }).click();
      await expect(page.getByText(/Loop window 0\.00s–4\.00s/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Whole sentence' })).toHaveCount(0);

      expect(await storedCounts(page)).toEqual({ attempts: 0, reviews: 0, studyItems: 0 });
    });
  });
}
