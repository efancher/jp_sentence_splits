import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThenAndNowGame } from '../src/components/games/ThenAndNowGame';
import { ensureSettings, resetDbForTests } from '../src/db/database';
import { ensureStudyItem, getDb, recordReview } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { withAppProviders } from '../src/test/providers';

// jsdom has no AudioContext: fake the decode and skip real Web Audio playback,
// same recipe as segmentLoopPlayer.test.tsx.
const decodeAudioBuffer = vi.fn(async (_blob: Blob): Promise<unknown> => ({
  duration: 3,
  sampleRate: 16000,
  numberOfChannels: 1,
  length: 48000,
  getChannelData: () => new Float32Array(48000),
}));
vi.mock('../src/lib/waveform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/waveform')>()),
  decodeAudioBuffer: (blob: Blob) => decodeAudioBuffer(blob),
}));
// fake-indexeddb hands Blobs back as plain objects, which the real hook would then try to re-download.
vi.mock('../src/hooks/useSentenceAudioBlob', () => {
  const clip = new Blob(['clip'], { type: 'audio/mpeg' });
  return { useSentenceAudioBlob: () => clip };
});
vi.mock('../src/lib/duckedRangePlayer', () => ({
  DuckedRangePlayer: class {
    play = vi.fn(async (_buffer: unknown, _range: unknown, _duckRanges: unknown, options: { onEnded?: () => void } = {}) => {
      options.onEnded?.();
    });
    stop = vi.fn();
    dispose = vi.fn();
  },
}));

const T = '2026-09-27T00:00:00Z';
const OLD_REVIEW = new Date('2026-09-01T00:00:00Z');

async function addReviewedSentence(sentenceId: string) {
  const db = getDb();
  await db.sentences.add({
    id: sentenceId,
    normalizedKey: sentenceId,
    japanese: 'これは桜です。',
    readingOnly: '',
    inlineReading: 'これは桜です。',
    translation: `tr ${sentenceId}`,
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: T,
    updatedAt: T,
  });
  const studyItem = await ensureStudyItem('sentence', sentenceId, 'cloze');
  await recordReview({ studyItemId: studyItem.id, rating: 'good', now: OLD_REVIEW });
  await db.books.add({ id: 'b1', title: 'Book', createdAt: T, updatedAt: T });
  await db.bookSentences.add({ id: `m-${sentenceId}`, bookId: 'b1', sentenceId, position: 0, status: 'unstarted', addedAt: T } as never);
  await db.sentenceAudio.add({
    id: `a-${sentenceId}`,
    sentenceId,
    sourceId: 'src',
    sourceSentenceId: sentenceId,
    sourceTitle: 'src',
    mimeType: 'audio/mpeg',
    durationMs: 3000,
    startMs: 0,
    endMs: 3000,
    blob: new Blob(['x'], { type: 'audio/mpeg' }),
    importedAt: T,
  });
  await db.referenceAlignments.put({
    id: `a-${sentenceId}`,
    alignmentVersion: 3,
    computedAt: T,
    result: {
      durationSeconds: 3,
      words: [
        { text: 'これは', start: 0, end: 1, phones: [] },
        { text: '桜', start: 1, end: 1.6, phones: [] },
        { text: 'です', start: 1.6, end: 3, phones: [] },
      ],
    },
  });
  await db.vocabularyItems.add({
    id: 'vi-1',
    expression: '桜',
    reading: 'さくら',
    meaning: 'cherry blossom',
    createdAt: '2026-09-20T00:00:00Z', // after OLD_REVIEW — "then-unknown"
    updatedAt: T,
  });
  await db.sentenceVocabulary.add({
    id: 'sv-1',
    sentenceId,
    vocabularyItemId: 'vi-1',
    surfaceForm: '桜',
    createdAt: T,
    updatedAt: T,
  });
}

describe('ThenAndNowGame', () => {
  beforeEach(async () => {
    resetDbForTests(`then-and-now-${createId('db')}`);
    await ensureSettings();
  });

  it('plays a clip both ways and moves on without touching gameRounds/reviews beyond the fixture', async () => {
    await addReviewedSentence('s1');
    render(
      withAppProviders(
        <MemoryRouter>
          <ThenAndNowGame signal="weak" />
        </MemoryRouter>,
      ),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));

    await screen.findByText(/Back then you didn't know/);
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next).toBeDisabled();

    fireEvent.click(await screen.findByRole('button', { name: /Then \(/ }));
    await waitFor(() => expect(next).toBeDisabled()); // "now" not played yet
    fireEvent.click(screen.getByRole('button', { name: /Now \(/ }));
    await waitFor(() => expect(next).not.toBeDisabled());
    fireEvent.click(next);

    expect(await screen.findByText(/nothing here was graded/)).toBeInTheDocument();
    expect(await getDb().gameRounds.count()).toBe(0);
    expect(await getDb().reviews.count()).toBe(1); // only the fixture's own review
  });

  it('explains what it needs when no sentence qualifies', async () => {
    render(
      withAppProviders(
        <MemoryRouter>
          <ThenAndNowGame signal="weak" />
        </MemoryRouter>,
      ),
    );

    expect(await screen.findByText(/Needs a sentence you reviewed at least/)).toBeInTheDocument();
  });
});
