import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { SpeakerMatchGame } from '../src/components/games/SpeakerMatchGame';
import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { withAppProviders } from '../src/test/providers';

const T = '2026-09-27T00:00:00Z';

async function addSentence(id: string, japanese: string) {
  await getDb().sentences.add({
    id,
    normalizedKey: id,
    japanese,
    readingOnly: '',
    inlineReading: japanese,
    translation: `tr ${id}`,
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: T,
    updatedAt: T,
  });
}

async function addAudioAndAlignment(id: string, sentenceId: string, surfaceForm: string) {
  const db = getDb();
  await db.sentenceAudio.add({
    id,
    sentenceId,
    sourceId: 'src',
    sourceSentenceId: sentenceId,
    sourceTitle: 'Source',
    mimeType: 'audio/mpeg',
    durationMs: 1000,
    startMs: 0,
    endMs: 1000,
    blob: new Blob(['x'], { type: 'audio/mpeg' }),
    importedAt: T,
  });
  await db.referenceAlignments.put({
    id,
    alignmentVersion: 3,
    result: { durationSeconds: 1, words: [{ text: surfaceForm, start: 0, end: 1, phones: [] }] },
    computedAt: T,
  });
}

/** One playable citation-form clip of `expression`, mined into `bookId`. */
async function addSpeakerClip(
  vocabularyItemId: string,
  expression: string,
  reading: string,
  bookId: string,
  bookTitle: string,
) {
  const db = getDb();
  if (!(await db.vocabularyItems.get(vocabularyItemId))) {
    await db.vocabularyItems.add({
      id: vocabularyItemId,
      expression,
      reading,
      meaning: `meaning of ${expression}`,
      pitchAccentPositions: [0],
      createdAt: T,
      updatedAt: T,
    });
  }
  if (!(await db.books.get(bookId))) {
    await db.books.add({ id: bookId, title: bookTitle, createdAt: T, updatedAt: T });
  }
  const sentenceId = `sent-${vocabularyItemId}-${bookId}`;
  await addSentence(sentenceId, expression);
  await addAudioAndAlignment(`audio-${vocabularyItemId}-${bookId}`, sentenceId, expression);
  await db.sentenceVocabulary.add({
    id: `sv-${vocabularyItemId}-${bookId}`,
    sentenceId,
    vocabularyItemId,
    surfaceForm: expression,
    createdAt: T,
    updatedAt: T,
  });
  await db.bookSentences.add({
    id: `bs-${vocabularyItemId}-${bookId}`,
    bookId,
    sentenceId,
    position: 0,
    createdAt: T,
    updatedAt: T,
  });
}

/** Two words, each mined into two different books — enough for a 2-trial round. */
async function seedTwoCrossBookWords() {
  await addSpeakerClip('voc-cat', '猫', 'ねこ', 'book-x', 'Book X');
  await addSpeakerClip('voc-cat', '猫', 'ねこ', 'book-y', 'Book Y');
  await addSpeakerClip('voc-dog', '犬', 'いぬ', 'book-x', 'Book X');
  await addSpeakerClip('voc-dog', '犬', 'いぬ', 'book-y', 'Book Y');
}

describe('SpeakerMatchGame', () => {
  beforeEach(async () => {
    resetDbForTests(`speaker-match-${createId('db')}`);
    await ensureSettings();
  });

  it('plays a full round — guess, reveal, score, log — without touching FSRS', async () => {
    await seedTwoCrossBookWords();
    render(
      withAppProviders(
        <MemoryRouter>
          <SpeakerMatchGame signal="weak" />
        </MemoryRouter>,
      ),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));

    await screen.findByText(/Which clip is from/);
    fireEvent.click(screen.getByRole('button', { name: 'Clip 1' }));
    await screen.findByText(/Right — Clip|Actually Clip/);
    fireEvent.click(screen.getByRole('button', { name: 'Next pair' }));

    await screen.findByText(/Which clip is from/);
    fireEvent.click(screen.getByRole('button', { name: 'Clip 1' }));
    await screen.findByText(/Right — Clip|Actually Clip/);
    fireEvent.click(screen.getByRole('button', { name: 'See results' }));

    expect(await screen.findByText(/\/ 2 points/)).toBeInTheDocument();
    expect(screen.getByText(/of 2 correct/)).toBeInTheDocument();

    await waitFor(async () => expect(await getDb().gameRounds.count()).toBe(1));
    const [round] = await getDb().gameRounds.toArray();
    expect(round!.gameId).toBe('speaker-match');
    expect(round!.items).toHaveLength(2);
    expect(await getDb().reviews.count()).toBe(0);
    expect(await getDb().studyItems.count()).toBe(0);
  });

  it('explains what it needs when no word has clips from 2+ books', async () => {
    await addSpeakerClip('voc-cat', '猫', 'ねこ', 'book-x', 'Book X');

    render(
      withAppProviders(
        <MemoryRouter>
          <SpeakerMatchGame signal="weak" />
        </MemoryRouter>,
      ),
    );

    expect(await screen.findByText(/Needs confirmed words mined from playable native clips/)).toBeInTheDocument();
  });
});
