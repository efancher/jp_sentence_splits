import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb, saveAttemptAlignment, saveReferenceAlignment } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import * as analysisApi from '../src/lib/analysisApi';
import { ShadowPage } from '../src/pages/ShadowPage';
import { withAppProviders } from '../src/test/providers';

vi.mock('../src/lib/analysisApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/analysisApi')>()),
  alignAudio: vi.fn(),
  transcribeAudio: vi.fn(),
}));

async function seed() {
  const db = getDb();
  const now = new Date().toISOString();
  await db.books.add({
    id: 'book-1',
    title: 'Test Book',
    archived: false,
    chapters: [],
    updatedAt: now,
  });
  await db.sentences.add({
    id: 'sent-1',
    normalizedKey: 'sent-1',
    japanese: '本を読みます。',
    readingOnly: '',
    inlineReading: '',
    translation: 'I read a book.',
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: now,
    updatedAt: now,
  });
  await db.sentenceAudio.add({
    id: 'audio-1',
    sentenceId: 'sent-1',
    sourceId: 'source-1',
    sourceSentenceId: 'source-sent-1',
    sourceTitle: 'Reference Video',
    mimeType: 'audio/mp4',
    durationMs: 1_200,
    startMs: 0,
    endMs: 1_200,
    blob: new Blob(['ref'], { type: 'audio/mp4' }),
    importedAt: now,
  });
  await db.attempts.bulkAdd([
    {
      id: 'attempt-older',
      sentenceId: 'sent-1',
      mimeType: 'audio/webm',
      durationMs: 2_000,
      blob: new Blob(['older'], { type: 'audio/webm' }),
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'attempt-newer',
      sentenceId: 'sent-1',
      mimeType: 'audio/webm',
      durationMs: 1_500,
      blob: new Blob(['newer'], { type: 'audio/webm' }),
      createdAt: '2026-01-02T00:00:00.000Z',
      manualRating: 'better',
      notes: 'Watch the pitch drop on 読みます',
    },
  ]);
}

/** A single-word alignment result with an っ (small tsu) hold of `tHoldMs`, for segment-timing tests. */
function chottoWord(tHoldMs: number) {
  const firstOEnd = 0.69;
  const tHoldEnd = firstOEnd + tHoldMs / 1000;
  const finalOEnd = tHoldEnd + 0.05;
  return {
    start: 0.5,
    end: finalOEnd,
    text: 'ちょっと',
    phones: [
      { start: 0.5, end: 0.6, text: 'tɕ' },
      { start: 0.6, end: firstOEnd, text: 'o' },
      { start: firstOEnd, end: tHoldEnd, text: 'tː' },
      { start: tHoldEnd, end: finalOEnd, text: 'o' },
    ],
  };
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

describe('ShadowPage', () => {
  beforeEach(async () => {
    resetDbForTests(`shadow-page-${createId('db')}`);
    await ensureSettings();
    await seed();
    // Blob-round-trip-through-Dexie compat (fake-indexeddb/jsdom Blob
    // mismatch) is handled globally now — see src/test/setup.ts.
    // Default: server alignment "unavailable" (matches an off-tailnet
    // device) — individual tests override this to check the "ready" path.
    vi.mocked(analysisApi.alignAudio).mockResolvedValue(null);
    vi.mocked(analysisApi.transcribeAudio).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the reference clip, record control, and past attempts', async () => {
    renderShadowPage();

    expect(await screen.findByText('本を読みます。')).toBeInTheDocument();
    expect(await screen.findByLabelText('Reference audio')).toBeInTheDocument();
    expect(screen.getByLabelText('Playback speed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark start' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark end' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument();

    const shadowModeCheckbox = screen.getByRole('checkbox', {
      name: /Shadow mode/,
    });
    expect(shadowModeCheckbox).toBeInTheDocument();
    expect(shadowModeCheckbox).toBeEnabled(); // reference audio is present
    expect(screen.getByRole('button', { name: 'Calibrate mic' })).toBeInTheDocument();

    const attemptRows = screen.getAllByRole('listitem');
    expect(attemptRows).toHaveLength(2);
    // Newest first.
    expect(within(attemptRows[0]!).getByText(/1\.5s/)).toBeInTheDocument();
    expect(within(attemptRows[0]!).getByText(/better/)).toBeInTheDocument();
    expect(within(attemptRows[0]!).getByText('Watch the pitch drop on 読みます')).toBeInTheDocument();
    expect(within(attemptRows[1]!).getByText(/2\.0s/)).toBeInTheDocument();

    const betterButtons = screen.getAllByRole('button', { name: 'Better' });
    expect(betterButtons[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles the hide/show transcript control', async () => {
    const user = userEvent.setup();
    renderShadowPage();
    await screen.findByText('本を読みます。');

    await user.click(screen.getByRole('button', { name: 'Hide transcript' }));
    expect(screen.queryByText('本を読みます。')).not.toBeInTheDocument();
    expect(screen.getByText('Audio-only practice')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show transcript' }));
    expect(screen.getByText('本を読みます。')).toBeInTheDocument();
    expect(screen.queryByText('Audio-only practice')).not.toBeInTheDocument();
  });

  it('toggles the meaning-instead-of-Japanese control', async () => {
    const user = userEvent.setup();
    renderShadowPage();
    await screen.findByText('本を読みます。');

    await user.click(screen.getByRole('button', { name: 'Show meaning instead' }));
    expect(screen.queryByText('本を読みます。')).not.toBeInTheDocument();
    expect(screen.getByText('I read a book.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show Japanese' }));
    expect(screen.getByText('本を読みます。')).toBeInTheDocument();
    expect(screen.queryByText('I read a book.')).not.toBeInTheDocument();
  });

  it('disables the meaning-instead control when the sentence has no translation', async () => {
    await getDb().sentences.update('sent-1', { translation: '' });
    renderShadowPage();
    await screen.findByText('本を読みます。');
    expect(screen.getByRole('button', { name: 'Show meaning instead' })).toBeDisabled();
  });

  it('plays the reference clip and shows a pending state when starting delayed shadow', async () => {
    const user = userEvent.setup();
    renderShadowPage();
    await screen.findByText('本を読みます。');

    const audio = (await screen.findByLabelText('Reference audio')) as HTMLAudioElement;
    const playSpy = vi.fn(async () => {});
    audio.play = playSpy;

    await user.click(screen.getByRole('button', { name: 'Delayed shadow' }));
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Listen, then get ready…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delayed shadow' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Delayed shadow' })).toBeInTheDocument();
    expect(screen.queryByText('Listen, then get ready…')).not.toBeInTheDocument();
  });

  it('starts recording after the reference clip ends and the delay elapses', async () => {
    const user = userEvent.setup();
    renderShadowPage();
    await screen.findByText('本を読みます。');

    const audio = (await screen.findByLabelText('Reference audio')) as HTMLAudioElement;
    audio.play = vi.fn(async () => {});
    await user.selectOptions(screen.getByLabelText('Delay before recording'), '500');
    await user.click(screen.getByRole('button', { name: 'Delayed shadow' }));

    fireEvent(audio, new Event('ended'));

    // Delay elapses (real timers — the timeout lives inside an 'ended'
    // listener, not directly reachable by vi.useFakeTimers here) and the
    // page falls back out of the pending state once startRecording settles.
    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: 'Delayed shadow' })).toBeInTheDocument();
      },
      { timeout: 2_000 },
    );
  });

  it('favorites and unfavorites an attempt', async () => {
    const user = userEvent.setup();
    renderShadowPage();
    await screen.findByText('本を読みます。');

    const favoriteButtons = screen.getAllByRole('button', { name: 'Favorite' });
    await user.click(favoriteButtons[0]!);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Unfavorite' })).toBeInTheDocument();
    });
    expect(screen.getByText(/★/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Unfavorite' }));
    await waitFor(() => {
      expect(screen.queryByText(/★/)).not.toBeInTheDocument();
    });
  });

  it('opens and closes the analysis panel for an attempt', async () => {
    const user = userEvent.setup();
    renderShadowPage();
    await screen.findByText('本を読みます。');

    const analyzeButtons = screen.getAllByRole('button', { name: 'Analyze' });
    await user.click(analyzeButtons[0]!);

    expect(
      screen.getByRole('button', { name: 'Close analysis' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'original' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'onset-aligned' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speaker-normalized' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close analysis' }));
    expect(screen.queryByRole('button', { name: 'original' })).not.toBeInTheDocument();
  });

  it('shows server word timing once the alignment service resolves', async () => {
    vi.mocked(analysisApi.alignAudio).mockResolvedValue({
      durationSeconds: 1.7,
      words: [
        { start: 0, end: 0.5, text: '<eps>', phones: [] },
        { start: 0.5, end: 0.84, text: 'ちょっと', phones: [] },
      ],
    });
    const user = userEvent.setup();
    renderShadowPage();
    await screen.findByText('本を読みます。');

    await user.click(screen.getAllByRole('button', { name: 'Analyze' })[0]!);

    expect(await screen.findByText('Word timing (server)')).toBeInTheDocument();
    // Silence (<eps>) is filtered out of the visible chip row.
    expect(screen.queryByText('<eps>')).not.toBeInTheDocument();
    expect(screen.getAllByText('ちょっと').length).toBeGreaterThan(0);
  });

  it('surfaces a segment-timing observation when reference and learner alignment differ', async () => {
    // Pre-seed the Dexie cache directly with distinct reference/learner
    // results (rather than trying to distinguish an `alignAudio` mock call
    // by blob content — Dexie-round-tripped Blobs in this test environment
    // lose their real methods, see src/test/setup.ts's Blob-clone note).
    await saveReferenceAlignment('audio-1', {
      durationSeconds: 1.7,
      words: [chottoWord(100)],
    });
    await saveAttemptAlignment('attempt-newer', {
      durationSeconds: 1.5,
      words: [chottoWord(20)],
    });

    const user = userEvent.setup();
    renderShadowPage();
    await screen.findByText('本を読みます。');

    await user.click(screen.getAllByRole('button', { name: 'Analyze' })[0]!);

    expect(await screen.findByText('Segment timing')).toBeInTheDocument();
    // Appears twice: once in the "Segment timing" detail list, once in the
    // "Focus on this" callout below.
    expect(
      screen.getAllByText('Your 「っ」 in 「ちょっと」 is much shorter than the reference.'),
    ).toHaveLength(2);

    // "Focus on this" surfaces the same finding as the primary issue, and
    // practicing it drives the *existing* target-range/loop mechanism
    // (Phase 8.2) — not a new, separate practice workflow.
    const focusOnThis = screen.getByLabelText('Focus on this');
    expect(
      within(focusOnThis).getByText('Your 「っ」 in 「ちょっと」 is much shorter than the reference.'),
    ).toBeInTheDocument();

    await user.click(within(focusOnThis).getByRole('button', { name: 'Practice this part' }));
    expect(screen.getByText(/Target: 0\.5s–0\.8s/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Loop target' })).toBeEnabled();
  });

  it('lists every ranked observation, not just the primary one, behind a disclosure', async () => {
    await saveReferenceAlignment('audio-1', {
      durationSeconds: 1.7,
      words: [chottoWord(100)],
    });
    await saveAttemptAlignment('attempt-newer', {
      durationSeconds: 1.5,
      words: [chottoWord(20)],
    });

    const user = userEvent.setup();
    renderShadowPage();
    await screen.findByText('本を読みます。');
    await user.click(screen.getAllByRole('button', { name: 'Analyze' })[0]!);

    const disclosure = await screen.findByText(/All observations \(\d+\)/);
    expect(disclosure).toBeInTheDocument();
    await user.click(disclosure);
    // The primary finding shows up a third time inside the full ranked list
    // (already appears in "Segment timing" and "Focus on this").
    expect(
      screen.getAllByText('Your 「っ」 in 「ちょっと」 is much shorter than the reference.'),
    ).toHaveLength(3);
  });

  it('shows a "closer than last time" note when a re-recorded attempt has the same issue but smaller', async () => {
    await saveReferenceAlignment('audio-1', {
      durationSeconds: 1.7,
      words: [chottoWord(100)],
    });
    // Older attempt: っ almost entirely dropped, a stark gap from the 100ms reference.
    await saveAttemptAlignment('attempt-older', {
      durationSeconds: 1.5,
      words: [chottoWord(10)],
    });
    // Newer attempt: still short, but the gap has narrowed a lot.
    await saveAttemptAlignment('attempt-newer', {
      durationSeconds: 1.5,
      words: [chottoWord(55)],
    });

    const user = userEvent.setup();
    renderShadowPage();
    await screen.findByText('本を読みます。');

    // Attempts render newest-first — analyze the older one first so it has
    // a saved summary by the time the newer one is analyzed.
    await user.click(screen.getAllByRole('button', { name: 'Analyze' })[1]!);
    expect(
      await screen.findAllByText('Your 「っ」 in 「ちょっと」 is much shorter than the reference.'),
    ).toHaveLength(2);
    await waitFor(async () => {
      expect(await getDb().attemptAnalysisSummaries.get('attempt-older')).toBeDefined();
    });
    await user.click(screen.getByRole('button', { name: 'Close analysis' }));

    // Both rows show "Analyze" again now that attempt-older's panel is
    // closed — attempt-newer is index 0 (attempts render newest-first).
    await user.click(screen.getAllByRole('button', { name: 'Analyze' })[0]!);
    expect(
      await screen.findAllByText('Your 「っ」 in 「ちょっと」 is shorter than the reference.'),
    ).toHaveLength(2);
    expect(
      await screen.findByText(
        'Closer than last time — still the same kind of thing, but the gap is smaller.',
      ),
    ).toBeInTheDocument();
  });

  it('has no server word timing section when the alignment service is unreachable', async () => {
    const user = userEvent.setup();
    renderShadowPage();
    await screen.findByText('本を読みます。');

    await user.click(screen.getAllByRole('button', { name: 'Analyze' })[0]!);

    // Local analysis still works; the local-analysis alignment/pitch UI
    // still renders exactly as before.
    expect(screen.getByRole('button', { name: 'original' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Fetching server word timing…')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Word timing (server)')).not.toBeInTheDocument();
  });

  it('surfaces a hedged ASR diagnostic when the recognized text differs from the reference', async () => {
    await saveReferenceAlignment('audio-1', {
      durationSeconds: 1.2,
      words: [
        { start: 0, end: 0.3, text: '本', phones: [] },
        { start: 0.3, end: 0.5, text: 'を', phones: [] },
        { start: 0.5, end: 1.2, text: '読みます', phones: [] },
      ],
    });
    vi.mocked(analysisApi.transcribeAudio).mockResolvedValue('本を見ます');

    const user = userEvent.setup();
    renderShadowPage();
    await screen.findByText('本を読みます。');

    await user.click(screen.getAllByRole('button', { name: 'Analyze' })[0]!);

    expect(await screen.findByText('Possible pronunciation differences')).toBeInTheDocument();
    // May also appear in the "Focus on this" callout if it's the
    // highest-ranked observation — either way, it must appear at least once.
    expect(
      screen.getAllByText('Possible pronunciation difference around 「読みます」.').length,
    ).toBeGreaterThanOrEqual(1);
    // Hedged, low confidence — never presented as a definite error.
    expect(screen.getAllByText(/low confidence:/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows pronunciation history trend labels once attempts have been analyzed', async () => {
    const chottoWord = (tHoldMs: number) => {
      const firstOEnd = 0.69;
      const tHoldEnd = firstOEnd + tHoldMs / 1000;
      const finalOEnd = tHoldEnd + 0.05;
      return {
        start: 0.5,
        end: finalOEnd,
        text: 'ちょっと',
        phones: [
          { start: 0.5, end: 0.6, text: 'tɕ' },
          { start: 0.6, end: firstOEnd, text: 'o' },
          { start: firstOEnd, end: tHoldEnd, text: 'tː' },
          { start: tHoldEnd, end: finalOEnd, text: 'o' },
        ],
      };
    };
    await saveReferenceAlignment('audio-1', { durationSeconds: 1.7, words: [chottoWord(100)] });
    // Older attempt: っ far too short (severity ~1.0, "needs work"). Newer
    // attempt: still short but meaningfully closer (severity ~0.43,
    // "improving" — 70%+ of the previous severity per trendLabel's ratio).
    await saveAttemptAlignment('attempt-older', { durationSeconds: 1.5, words: [chottoWord(20)] });
    await saveAttemptAlignment('attempt-newer', { durationSeconds: 1.65, words: [chottoWord(55)] });

    const user = userEvent.setup();
    renderShadowPage();
    await screen.findByText('本を読みます。');

    const rows = screen.getAllByRole('listitem');
    // Newest first: rows[0] = attempt-newer, rows[1] = attempt-older.
    await user.click(within(rows[1]!).getByRole('button', { name: 'Analyze' }));
    await within(rows[1]!).findByText('Segment timing');

    await user.click(within(rows[0]!).getByRole('button', { name: 'Analyze' }));
    await within(rows[0]!).findByText('Segment timing');

    await waitFor(() => {
      expect(within(rows[1]!).getByText(/Timing: needs work/)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(within(rows[0]!).getByText(/Timing: improving/)).toBeInTheDocument();
    });
  });

  it('marks a target range from the reference player and can clear it', async () => {
    const user = userEvent.setup();
    renderShadowPage();

    const referenceAudio = (await screen.findByLabelText(
      'Reference audio',
    )) as HTMLAudioElement;
    Object.defineProperty(referenceAudio, 'currentTime', {
      configurable: true,
      writable: true,
      value: 0.5,
    });

    await user.click(screen.getByRole('button', { name: 'Mark start' }));
    referenceAudio.currentTime = 2.3;
    await user.click(screen.getByRole('button', { name: 'Mark end' }));

    expect(screen.getByText(/Target: 0\.5s–2\.3s/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Loop target' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Clear target' }));
    expect(screen.queryByText(/Target:/)).not.toBeInTheDocument();
  });

  it('shows a mora breakdown when the sentence has reading data, hidden with the transcript', async () => {
    const user = userEvent.setup();
    await getDb().sentences.update('sent-1', {
      inlineReading: '本[ほん]を 読[よ]みます。',
    });
    renderShadowPage();
    await screen.findByText('本を読みます。');

    const breakdown = screen.getByLabelText('Mora breakdown');
    for (const mora of ['ほ', 'ん', 'を', 'よ', 'み', 'ま', 'す']) {
      expect(within(breakdown).getByText(mora)).toBeInTheDocument();
    }

    await user.click(screen.getByRole('button', { name: 'Hide transcript' }));
    expect(screen.queryByLabelText('Mora breakdown')).not.toBeInTheDocument();
  });

  it('has no mora breakdown when the sentence has no reading data', async () => {
    renderShadowPage();
    await screen.findByText('本を読みます。');
    expect(screen.queryByLabelText('Mora breakdown')).not.toBeInTheDocument();
  });

  it('deletes an attempt after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderShadowPage();

    expect(await screen.findAllByRole('listitem')).toHaveLength(2);
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    await user.click(deleteButtons[0]!);

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
    });
  });

  it('does not delete when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderShadowPage();

    expect(await screen.findAllByRole('listitem')).toHaveLength(2);
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    await user.click(deleteButtons[0]!);

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});
