import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { resetDbForTests } from '../src/db/database';
import { getDb, saveReferenceAlignment, updateSettings } from '../src/db/repository';
import * as analysisApi from '../src/lib/analysisApi';
import { createId } from '../src/lib/ids';
import { ShadowPage, ShadowWorkspace } from '../src/pages/ShadowPage';
import { withAppProviders } from '../src/test/providers';

vi.mock('../src/lib/analysisApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/analysisApi')>()),
  alignAudio: vi.fn(),
  transcribeAudio: vi.fn(),
}));

const WORDS = [
  { text: '猫', start: 0, end: 0.4, phones: [] },
  { text: 'が', start: 0.4, end: 0.5, phones: [] },
  { text: '寝て', start: 0.5, end: 1.0, phones: [] },
  { text: 'います', start: 1.0, end: 1.6, phones: [] },
  { text: 'ね', start: 1.6, end: 4.0, phones: [] },
];

async function seed() {
  const db = getDb();
  const now = new Date().toISOString();
  await db.books.add({ id: 'book-1', title: 'Test Book', archived: false, chapters: [], updatedAt: now });
  await db.sentences.add({
    id: 'sent-1', normalizedKey: 'sent-1', japanese: '猫が寝ていますね。', readingOnly: '', inlineReading: '', translation: 'x',
    targetVocabulary: [], vocabularySuggestions: [], sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0,
    importBatchIds: [], createdAt: now, updatedAt: now,
  });
  await db.sentenceAudio.add({
    id: 'audio-1', sentenceId: 'sent-1', sourceId: 'source-1', sourceSentenceId: 'src-1', sourceTitle: 'Ref',
    mimeType: 'audio/mp4', durationMs: 4_000, startMs: 0, endMs: 4_000, blob: new Blob(['ref'], { type: 'audio/mp4' }), importedAt: now,
  });
  await db.vocabularyItems.put({ id: 'v-sleep', expression: '寝る', reading: 'ねる', createdAt: now, updatedAt: now } as never);
  await db.sentenceVocabulary.put({ id: 'sv-1', sentenceId: 'sent-1', vocabularyItemId: 'v-sleep', surfaceForm: '寝て' } as never);
}

function renderShadowPage() {
  return render(
    withAppProviders(
      <MemoryRouter initialEntries={['/books/book-1/shadow/sent-1']}>
        <Routes>
          <Route path="books/:bookId/shadow/:sentenceId" element={<ShadowPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

function renderWorkspaceFocused(focusSurface: string) {
  return render(
    withAppProviders(
      <MemoryRouter>
        <ShadowWorkspace bookId="book-1" sentenceId="sent-1" embedded focusSurface={focusSurface} />
      </MemoryRouter>,
    ),
  );
}

describe('ShadowPage phrase shadowing', () => {
  beforeEach(() => {
    resetDbForTests(`shadow-phrase-${createId('db')}`);
    // The aligner service is not reachable in tests; the alignment is cached by the test itself, as the pane would.
    vi.mocked(analysisApi.alignAudio).mockReset();
  });

  it('offers the suggested phrase once the alignment is cached, and rates it from the sliders', async () => {
    const user = userEvent.setup();
    await seed();
    renderShadowPage();

    // The page opens before any alignment exists: no suggestion, no rating row.
    await screen.findByText(/Loop window/);
    expect(screen.queryByText(/Suggested phrase/)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Rate this phrase' })).toBeNull();

    // The alignment lands later (the pane's pitch chart / synced text cache it): the suggestion appears without reopening.
    await saveReferenceAlignment('audio-1', { durationSeconds: 4, words: WORDS });
    expect(await screen.findByText(/Suggested phrase \(covers 寝る\)/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Use this phrase' }));
    const rating = await screen.findByRole('group', { name: 'Rate this phrase' });
    expect(rating.textContent).toContain('寝ています');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(async () => expect(await getDb().sentenceLearningEvents.count()).toBe(1));
    const [event] = await getDb().sentenceLearningEvents.toArray();
    expect(event).toMatchObject({
      action: 'phrase_shadow', outcome: 'close', sentenceId: 'sent-1', rangeStartMs: 500, rangeEndMs: 1600,
      target: { label: '寝ています' },
    });
    expect(await getDb().attempts.count()).toBe(0);
    expect(await getDb().reviews.count()).toBe(0);
  });

  it("opened on a tapped word, starts on that word's phrase without another tap", async () => {
    await seed();
    await saveReferenceAlignment('audio-1', { durationSeconds: 4, words: WORDS });
    renderWorkspaceFocused('寝て');
    const rating = await screen.findByRole('group', { name: 'Rate this phrase' });
    await waitFor(() => expect(rating.textContent).toContain('寝ています'));
  });

  it('a tapped word that is not in the sentence leaves the range alone', async () => {
    await seed();
    await saveReferenceAlignment('audio-1', { durationSeconds: 4, words: WORDS });
    renderWorkspaceFocused('犬');
    await screen.findByText(/Loop window/);
    await waitFor(() => expect(screen.queryByText(/Suggested phrase/)).toBeNull());
    expect(screen.queryByRole('group', { name: 'Rate this phrase' })).toBeNull();
  });

  it('while sentence shadowing is paused, presets the estimated phrase on open so it only needs fine-tuning', async () => {
    await seed();
    await updateSettings({ sentenceShadowingPaused: true });
    await saveReferenceAlignment('audio-1', { durationSeconds: 4, words: WORDS });
    renderShadowPage();
    const rating = await screen.findByRole('group', { name: 'Rate this phrase' });
    await waitFor(() => expect(rating.textContent).toContain('寝ています'));
    expect(rating.textContent).toContain('0.5–1.6s');
    // Already on the estimate, so there is nothing to offer.
    expect(screen.queryByRole('button', { name: 'Use this phrase' })).toBeNull();
  });

  it('does not preset when sentence shadowing is not paused, and keeps a range the learner already set', async () => {
    await seed();
    await saveReferenceAlignment('audio-1', { durationSeconds: 4, words: WORDS });
    renderShadowPage();
    expect(await screen.findByText(/Suggested phrase \(covers 寝る\)/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Rate this phrase' })).toBeNull();
  });

  it('opens the zoomed edge editor from Fine-tune phrase and closes it without changing the range', async () => {
    const user = userEvent.setup();
    await seed();
    await updateSettings({ sentenceShadowingPaused: true });
    await saveReferenceAlignment('audio-1', { durationSeconds: 4, words: WORDS });
    renderShadowPage();
    await screen.findByRole('group', { name: 'Rate this phrase' });

    await user.click(screen.getByRole('button', { name: 'Fine-tune phrase' }));
    expect(await screen.findByRole('group', { name: 'Word audio range editor' })).toBeTruthy();
    expect(screen.getByText(/Zoom in on the start and end of the phrase/)).toBeTruthy();
    // Nothing moved yet: Save stays disabled and there is no override to reset.
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Reset to automatic' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Word audio range editor' })).toBeNull();
    expect((await screen.findByRole('group', { name: 'Rate this phrase' })).textContent).toContain('0.5–1.6s');
  });
});
