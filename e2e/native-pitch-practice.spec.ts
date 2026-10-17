import { expect, test } from '@playwright/test';
import { ALIGNMENT_VERSION } from '../src/lib/analysisApi';
import { PITCH_TRACK_VERSION } from '../src/lib/pitch';

test('native preparation works before recording and stops when closed', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.getByRole('button', { name: 'Export all data' })).toBeVisible();
  await page.evaluate(async ({ alignmentVersion, pitchVersion }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('satori-glossbook');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const now = new Date().toISOString();
    // Playable synthetic WAV plus cached alignment/pitch. No live services or user data.
    const rate = 8000, samples = rate * 5.5;
    const buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer);
    const str = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(i / rate * Math.PI * 300) * 1000, true);
    const tx = db.transaction(['books', 'sentences', 'bookSentences', 'sentenceAudio', 'referenceAlignments', 'referencePitchTracks'], 'readwrite');
    tx.objectStore('books').put({ id: 'practice-book', title: 'Native preparation', chapters: [], collapsedChapterIds: [], createdAt: now, updatedAt: now });
    tx.objectStore('sentences').put({ id: 'practice-sentence', normalizedKey: 'practice-sentence', japanese: 'あなたはペットを飼っていますか？',
      inlineReading: 'あなたはペットを飼っ[かっ]ていますか？', readingOnly: 'あなたはぺっとをかっていますか', translation: 'Do you have a pet?',
      targetVocabulary: [], vocabularySuggestions: [], sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0, importBatchIds: [], createdAt: now, updatedAt: now });
    tx.objectStore('bookSentences').put({ id: 'practice-bs', bookId: 'practice-book', sentenceId: 'practice-sentence', position: 0, status: 'unstarted', addedAt: now });
    tx.objectStore('sentenceAudio').put({ id: 'practice-audio', sentenceId: 'practice-sentence', sourceId: 'src', sourceSentenceId: 'src-sentence',
      sourceTitle: 'Synthetic reference', mimeType: 'audio/wav', durationMs: 5500, startMs: 0, endMs: 5500, blob: new Blob([buffer], { type: 'audio/wav' }), importedAt: now });
    const token = (text: string, start: number, vowels: string[]) => ({ text, start, end: start + vowels.length * 0.2,
      phones: vowels.map((text, i) => ({ text, start: start + i * 0.2, end: start + (i + 1) * 0.2 })) });
    const words = [token('あなたは', 0.4, ['a', 'a', 'a', 'a']), token('ペットを', 1.8, ['e', 'e', 'o', 'o']),
      token('飼って', 3.15, ['a', 'a', 'e']), token('います', 3.8, ['i', 'a', 'u']), token('か', 4.4, ['a'])];
    tx.objectStore('referenceAlignments').put({ id: 'practice-audio', alignmentVersion, computedAt: now, result: { words, durationSeconds: 5.5 } });
    const frames = Array.from({ length: 550 }, (_, i) => ({ timeSeconds: i / 100, hz: 150, voiced: i % 60 < 50,
      confidence: 1, relativeSemitones: Math.sin(i / 35) * 4 }));
    tx.objectStore('referencePitchTracks').put({ id: 'practice-audio', pitchVersion, computedAt: now,
      payload: { frames, medianHz: 150, voicedRatio: 0.8, durationSeconds: 5.5 } });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  }, { alignmentVersion: ALIGNMENT_VERSION, pitchVersion: PITCH_TRACK_VERSION });
  await page.goto('/#/books/practice-book/shadow/practice-sentence');
  await page.getByRole('button', { name: 'Prepare with the native recording' }).click();
  await expect(page.getByRole('img', { name: 'Native pitch path with kana; dots summarize each mora' })).toBeVisible();
  await expect(page.getByRole('button', { name: '飼っていますか', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'あなたは', exact: true }).click();
  await page.getByRole('button', { name: 'Listen → repeat', exact: true }).click();
  await expect(page.getByText('Your turn — hum or say it.', { exact: true })).toBeVisible({ timeout: 6000 });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Whole sentence', exact: true }).click();
  await page.getByText('Recording detail', { exact: true }).click();
  await expect(page.getByRole('img', { name: /Recorded pitch on the actual time axis/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('native-practice.png'), fullPage: true });
  await page.getByRole('button', { name: 'Listen → repeat', exact: true }).click();
  await page.getByRole('button', { name: 'Close pitch practice' }).click();
  expect(await page.evaluate(() => [...document.querySelectorAll('audio')].every(a => a.paused))).toBe(true);
});
