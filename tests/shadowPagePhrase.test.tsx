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

// jsdom has no AudioContext: only the zoomed editor's decode step gets a fake clip (the rest of the page keeps
// degrading as before), and no real playback happens.
vi.mock('../src/lib/decodeWithRepair', () => ({
  decodeWithRepair: vi.fn(async () => ({
    duration: 4, sampleRate: 16000, numberOfChannels: 1, length: 64000, getChannelData: () => new Float32Array(64000),
  })),
}));
vi.mock('../src/lib/rangePlayer', () => ({
  RangePlayer: class {
    play = vi.fn(async () => undefined);
    stop = vi.fn();
    dispose = vi.fn();
  },
}));

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

    // Opens on Full sentence (no suggestion, no rating) until the learner picks Phrase.
    await screen.findByText(/Loop window/);
    expect(screen.getByRole('button', { name: 'Full sentence' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Phrase' }));
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
      action: 'phrase_shadow', outcome: 'close', sentenceId: 'sent-1', rangeStartMs: 500, rangeEndMs: 2100,
      target: { label: '寝ていますね' },
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
    expect(rating.textContent).toContain('0.5–2.1s');
    // Already on the estimate, so there is nothing to offer.
    expect(screen.queryByRole('button', { name: 'Use this phrase' })).toBeNull();
  });

  it('opens on Full sentence with no phrase offer, and choosing Phrase presets the estimated phrase', async () => {
    await seed();
    await saveReferenceAlignment('audio-1', { durationSeconds: 4, words: WORDS });
    renderShadowPage();
    // Full sentence mode offers no phrase at all; Phrase mode presets it.
    await screen.findByText(/Loop window/);
    expect(screen.queryByText(/Suggested phrase/)).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Phrase' }));
    await waitFor(() => expect(screen.queryByText(/Shadowing phrase:/)).toBeTruthy());
    expect(screen.queryByRole('group', { name: 'Rate this phrase' })).toBeTruthy();
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
    expect((screen.getByRole('button', { name: 'Use this span' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Back to the estimate' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Word audio range editor' })).toBeNull();
    expect((await screen.findByRole('group', { name: 'Rate this phrase' })).textContent).toContain('0.5–2.1s');
  });

  it('applying a fine-tuned span changes only the looped and rated span: no clip, trim, link or event is written', async () => {
    const user = userEvent.setup();
    await seed();
    await updateSettings({ sentenceShadowingPaused: true });
    await saveReferenceAlignment('audio-1', { durationSeconds: 4, words: WORDS });
    renderShadowPage();
    const rating = await screen.findByRole('group', { name: 'Rate this phrase' });
    await waitFor(() => expect(rating.textContent).toContain('0.5–2.1s'));

    const db = getDb();
    const before = {
      audio: JSON.stringify({ ...(await db.sentenceAudio.get('audio-1')), blob: undefined }),
      link: JSON.stringify(await db.sentenceVocabulary.get('sv-1')),
      events: await db.sentenceLearningEvents.count(),
    };

    await user.click(screen.getByRole('button', { name: 'Fine-tune phrase' }));
    await screen.findByRole('slider', { name: /start edge/i }); // decoded and ready
    await user.click(screen.getByRole('button', { name: /move start edge 100 ms/i }));
    await user.click(screen.getByRole('button', { name: 'Use this span' }));

    // The displayed (and so the rated) span moved...
    await waitFor(() => expect(screen.getByRole('group', { name: 'Rate this phrase' }).textContent).toContain('0.6–2.1s'));
    expect(screen.queryByRole('group', { name: 'Word audio range editor' })).toBeNull();
    // ...and nothing was persisted: the clip row (incl. any trim), the word link and the event log are as they were.
    expect(JSON.stringify({ ...(await db.sentenceAudio.get('audio-1')), blob: undefined })).toBe(before.audio);
    expect(JSON.stringify(await db.sentenceVocabulary.get('sv-1'))).toBe(before.link);
    expect(await db.sentenceLearningEvents.count()).toBe(before.events);
    expect(await db.attempts.count()).toBe(0);
  });
});

describe('ShadowWorkspace opened from a daily-plan step', () => {
  // 私は昨日、友達と駅で映画を見ました。 over 5.4 s plans a four-step chain (see chunkChainPanel.test.tsx).
  const PIECES: [string, string][] = [
    ['私', '名詞/普通名詞'], ['は', '助詞/係助詞'], ['昨日', '名詞/普通名詞'], ['、', '補助記号/読点'],
    ['友達', '名詞/普通名詞'], ['と', '助詞/格助詞'], ['駅', '名詞/普通名詞'], ['で', '助詞/格助詞'],
    ['映画', '名詞/普通名詞'], ['を', '助詞/格助詞'], ['見', '動詞/一般'], ['まし', '助動詞'], ['た', '助動詞'], ['。', '補助記号/句点'],
  ];
  const TIMED = [
    ['私', 0, 0.4], ['は', 0.4, 0.6], ['昨日', 0.8, 1.6], ['友達', 1.8, 2.4], ['と', 2.4, 2.6], ['駅', 2.8, 3.2],
    ['で', 3.2, 3.4], ['映画', 3.6, 4.2], ['を', 4.2, 4.4], ['見', 4.6, 4.8], ['まし', 4.8, 5.2], ['た', 5.2, 5.4],
  ] as const;

  async function seedChain() {
    const db = getDb();
    const now = new Date().toISOString();
    let cursor = 0;
    const vocabularySuggestions = PIECES.map(([surface, pos], i) => {
      const token = { id: `t${i}`, surface, start: cursor, end: cursor + surface.length, expression: surface, reading: surface, pos, source: 'morphology', selectedByDefault: false };
      cursor += surface.length;
      return token;
    });
    await db.books.add({ id: 'book-1', title: 'Test Book', archived: false, chapters: [], updatedAt: now });
    await db.sentences.add({
      id: 'sent-1', normalizedKey: 'sent-1', japanese: PIECES.map((p) => p[0]).join(''), readingOnly: '', inlineReading: '', translation: 'x',
      targetVocabulary: [], vocabularySuggestions, sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0,
      importBatchIds: [], createdAt: now, updatedAt: now,
    } as never);
    await db.sentenceAudio.add({
      id: 'audio-1', sentenceId: 'sent-1', sourceId: 'source-1', sourceSentenceId: 'src-1', sourceTitle: 'Ref',
      mimeType: 'audio/mp4', durationMs: 5_400, startMs: 0, endMs: 5_400, blob: new Blob(['ref'], { type: 'audio/mp4' }), importedAt: now,
    });
    await saveReferenceAlignment('audio-1', { durationSeconds: 5.4, words: TIMED.map(([text, start, end]) => ({ text, start, end, phones: [] })) });
  }

  function renderWorkspace(fromSessionStep: boolean) {
    return render(
      withAppProviders(
        <MemoryRouter>
          <ShadowWorkspace bookId="book-1" sentenceId="sent-1" embedded fromSessionStep={fromSessionStep} />
        </MemoryRouter>,
      ),
    );
  }

  beforeEach(() => {
    resetDbForTests(`shadow-chain-step-${createId('db')}`);
    vi.mocked(analysisApi.alignAudio).mockReset();
  });

  it('while sentence shadowing is paused, opens straight into the chunk chain', async () => {
    await seedChain();
    await updateSettings({ sentenceShadowingPaused: true });
    renderWorkspace(true);
    // Either the optional cold try or the first step: the chain is running, not waiting for a tap.
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Chunk chain' }) ?? screen.queryByRole('group', { name: 'Cold try' })).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: 'Chunk chain' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('opened by hand, or with sentence shadowing on, leaves the chain as a button', async () => {
    await seedChain();
    await updateSettings({ sentenceShadowingPaused: true });
    const { unmount } = renderWorkspace(false);
    expect(await screen.findByRole('button', { name: 'Chunk chain' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Chunk chain' })).toBeNull();
    unmount();

    await updateSettings({ sentenceShadowingPaused: false });
    renderWorkspace(true);
    expect(await screen.findByRole('button', { name: 'Chunk chain' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Chunk chain' })).toBeNull();
  });
});
