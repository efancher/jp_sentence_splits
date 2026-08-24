import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import * as analysisApi from '../src/lib/analysisApi';
import { ShadowPage } from '../src/pages/ShadowPage';
import { withAppProviders } from '../src/test/providers';

vi.mock('../src/lib/analysisApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/analysisApi')>()),
  alignAudio: vi.fn(),
  transcribeAudio: vi.fn(),
}));

// Same fakes as tests/shadowing.test.ts, needed here to exercise the
// Repeat/Compare stages' actual record -> stop lifecycle through the real
// ShadowingController that ShadowPage/ProgressiveShadowingPanel share.
class FakeMediaStreamTrack {
  stop = vi.fn();
}

class FakeMediaStream {
  private tracks = [new FakeMediaStreamTrack()];
  getTracks() {
    return this.tracks;
  }
}

type DataHandler = (event: { data: Blob }) => void;

class FakeMediaRecorder {
  static isTypeSupported() {
    return true;
  }

  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: DataHandler | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public stream: FakeMediaStream) {}

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['chunk'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function stubMediaDevices(
  getUserMedia: () => Promise<FakeMediaStream> = async () => new FakeMediaStream(),
) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(getUserMedia) },
  });
}

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

/** Stubs `.play`/`.duration` on the visible reference `<audio>` so playRange resolves immediately via an `ended` dispatch. */
function primeReferenceAudio(audio: HTMLAudioElement) {
  audio.play = vi.fn(async () => {});
  Object.defineProperty(audio, 'duration', { value: 0.1, configurable: true });
}

async function enterGuidedMode(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('本を読みます。');
  const audio = (await screen.findByLabelText('Reference audio')) as HTMLAudioElement;
  primeReferenceAudio(audio);
  await user.click(screen.getByRole('button', { name: 'Start guided practice' }));
  return audio;
}

describe('ProgressiveShadowingPanel (via ShadowPage)', () => {
  beforeEach(async () => {
    resetDbForTests(`progressive-shadowing-${createId('db')}`);
    await ensureSettings();
    await seed();
    vi.mocked(analysisApi.alignAudio).mockResolvedValue(null);
    vi.mocked(analysisApi.transcribeAudio).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the guided-practice toggle only when reference audio exists, and it swaps the panel in', async () => {
    const user = userEvent.setup();
    renderShadowPage();
    await enterGuidedMode(user);

    expect(screen.getByText('Stage 1 of 5 · Listen')).toBeInTheDocument();
    // Free-form controls are hidden while guided mode is active.
    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Shadow mode/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Exit guided practice' }));
    expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument();
  });

  it('Listen stage plays the reference audio; Next advances to Pause & Repeat', async () => {
    const user = userEvent.setup();
    renderShadowPage();
    const audio = await enterGuidedMode(user);

    await user.click(screen.getByRole('button', { name: '▶ Play native audio' }));
    expect(audio.play).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /Next: Pause & Repeat/ }));
    expect(screen.getByText('Stage 2 of 5 · Pause & Repeat')).toBeInTheDocument();
  });

  it('Back and Skip move between stages without recording', async () => {
    const user = userEvent.setup();
    renderShadowPage();
    await enterGuidedMode(user);

    await user.click(screen.getByRole('button', { name: 'Skip ›' }));
    expect(screen.getByText('Stage 2 of 5 · Pause & Repeat')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '‹ Back' }));
    expect(screen.getByText('Stage 1 of 5 · Listen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '‹ Back' })).toBeDisabled();
  });

  it('Restart session returns to Listen and clears progress', async () => {
    const user = userEvent.setup();
    renderShadowPage();
    await enterGuidedMode(user);

    await user.click(screen.getByRole('button', { name: 'Skip ›' }));
    await user.click(screen.getByRole('button', { name: 'Skip ›' }));
    expect(screen.getByText('Stage 3 of 5 · Delayed Shadow')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restart session' }));
    expect(screen.getByText('Stage 1 of 5 · Listen')).toBeInTheDocument();
  });

  describe('recording lifecycle (Repeat / Compare stages)', () => {
    beforeEach(() => {
      vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
      stubMediaDevices();
    });

    afterEach(() => vi.unstubAllGlobals());

    it('Pause & Repeat auto-stops after the reference clip ends, producing an ephemeral (unsaved) take', async () => {
      const user = userEvent.setup();
      renderShadowPage();
      const audio = await enterGuidedMode(user);
      // A short marked range keeps the auto-stop timer (segment * 1.6 + 700ms) fast in real time.
      Object.defineProperty(audio, 'currentTime', { value: 0, writable: true, configurable: true });
      await user.click(screen.getByRole('button', { name: 'Mark start' }));
      Object.defineProperty(audio, 'currentTime', { value: 0.1, writable: true, configurable: true });
      await user.click(screen.getByRole('button', { name: 'Mark end' }));

      await user.click(screen.getByRole('button', { name: 'Skip ›' }));
      expect(screen.getByText('Stage 2 of 5 · Pause & Repeat')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: '🎙 Play & repeat' }));
      fireEvent(audio, new Event('ended'));

      await waitFor(() => expect(screen.getByText(/Recording…/)).toBeInTheDocument(), {
        timeout: 2_000,
      });
      await waitFor(() => expect(screen.getByText('▶ Hear that back')).toBeInTheDocument(), {
        timeout: 3_000,
      });

      const db = getDb();
      expect(await db.attempts.count()).toBe(0);
    });

    it('a manual stop still works before the auto-stop timer fires', async () => {
      const user = userEvent.setup();
      renderShadowPage();
      const audio = await enterGuidedMode(user);
      await user.click(screen.getByRole('button', { name: 'Skip ›' }));

      await user.click(screen.getByRole('button', { name: '🎙 Play & repeat' }));
      fireEvent(audio, new Event('ended'));

      await waitFor(() => expect(screen.getByText(/Recording…/)).toBeInTheDocument(), {
        timeout: 2_000,
      });
      await user.click(screen.getByText(/Recording…/));

      expect(await screen.findByText('▶ Hear that back')).toBeInTheDocument();
    });

    it('retry discards the ephemeral take and stays on the same stage', async () => {
      const user = userEvent.setup();
      renderShadowPage();
      const audio = await enterGuidedMode(user);
      await user.click(screen.getByRole('button', { name: 'Skip ›' }));

      await user.click(screen.getByRole('button', { name: '🎙 Play & repeat' }));
      fireEvent(audio, new Event('ended'));
      await waitFor(() => expect(screen.getByText(/Recording…/)).toBeInTheDocument());
      await user.click(screen.getByText(/Recording…/));
      await screen.findByText('▶ Hear that back');

      await user.click(screen.getByRole('button', { name: 'Retry' }));
      expect(screen.getByText('Stage 2 of 5 · Pause & Repeat')).toBeInTheDocument();
      expect(screen.queryByText('▶ Hear that back')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '🎙 Play & repeat' })).toBeInTheDocument();
    });

    it('only the final Record & Compare take is saved, tagged with practiceStage and a practiceSessionId', async () => {
      const user = userEvent.setup();
      renderShadowPage();
      await enterGuidedMode(user);

      // Jump straight to Compare without recording on any earlier stage.
      await user.click(screen.getByRole('button', { name: 'Skip ›' }));
      await user.click(screen.getByRole('button', { name: 'Skip ›' }));
      await user.click(screen.getByRole('button', { name: 'Skip ›' }));
      await user.click(screen.getByRole('button', { name: 'Skip ›' }));
      expect(screen.getByText('Stage 5 of 5 · Record & Compare')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: '🎙 Record final attempt' }));
      await waitFor(() => expect(screen.getByText(/Recording…/)).toBeInTheDocument());
      await user.click(screen.getByText(/Recording…/));

      await user.click(await screen.findByRole('button', { name: 'Save attempt' }));

      await waitFor(async () => {
        const db = getDb();
        expect(await db.attempts.count()).toBe(1);
      });
      const db = getDb();
      const [saved] = await db.attempts.toArray();
      expect(saved?.practiceStage).toBe('final');
      expect(saved?.practiceSessionId).toBeTruthy();

      expect(await screen.findByText(/Saved\. Compare your take/)).toBeInTheDocument();
    });
  });
});
