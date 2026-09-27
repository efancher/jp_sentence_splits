import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { HomophoneHuntGame } from '../src/components/games/HomophoneHuntGame';
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
  await getDb().analyses.add({
    sentenceId: id,
    chunks: [],
    notes: '',
    status: 'empty',
    formatVersion: 2,
    vocabularyReviewStatus: 'confirmed',
    vocabularySelections: [],
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

async function addVocabWithPitchAccent(id: string, expression: string, reading: string, position: number) {
  const db = getDb();
  await db.vocabularyItems.add({
    id,
    expression,
    reading,
    meaning: `meaning of ${expression}`,
    pitchAccentPositions: [position],
    createdAt: T,
    updatedAt: T,
  });
}

/**
 * 箸 (atamadaka, pos 1) vs 橋 (heiban, pos 0), both はし — a real
 * near-minimal pair. Two occurrences of 橋 (one sharing 箸's book, one in a
 * different book) so `buildMinimalPairTrials` can build both the same-book
 * and cross-book variant, filling Homophone Hunt's 2-trial minimum from a
 * single contrast.
 */
async function seedHomophonePair() {
  const db = getDb();
  await addVocabWithPitchAccent('voc-chopsticks', '箸', 'はし', 1);
  await addVocabWithPitchAccent('voc-bridge', '橋', 'はし', 0);

  await addSentence('sent-a', '箸');
  await addAudioAndAlignment('audio-a', 'sent-a', '箸');
  await db.sentenceVocabulary.add({
    id: 'sv-a',
    sentenceId: 'sent-a',
    vocabularyItemId: 'voc-chopsticks',
    surfaceForm: '箸',
    createdAt: T,
    updatedAt: T,
  });
  await db.bookSentences.add({ id: 'bs-a', bookId: 'book-x', sentenceId: 'sent-a', position: 0, createdAt: T, updatedAt: T });

  await addSentence('sent-b', '橋');
  await addAudioAndAlignment('audio-b', 'sent-b', '橋');
  await db.sentenceVocabulary.add({
    id: 'sv-b',
    sentenceId: 'sent-b',
    vocabularyItemId: 'voc-bridge',
    surfaceForm: '橋',
    createdAt: T,
    updatedAt: T,
  });
  await db.bookSentences.add({ id: 'bs-b', bookId: 'book-x', sentenceId: 'sent-b', position: 1, createdAt: T, updatedAt: T });

  await addSentence('sent-b2', '橋');
  await addAudioAndAlignment('audio-b2', 'sent-b2', '橋');
  await db.sentenceVocabulary.add({
    id: 'sv-b2',
    sentenceId: 'sent-b2',
    vocabularyItemId: 'voc-bridge',
    surfaceForm: '橋',
    createdAt: T,
    updatedAt: T,
  });
  await db.bookSentences.add({ id: 'bs-b2', bookId: 'book-y', sentenceId: 'sent-b2', position: 0, createdAt: T, updatedAt: T });
}

describe('HomophoneHuntGame', () => {
  beforeEach(async () => {
    resetDbForTests(`homophone-hunt-${createId('db')}`);
    await ensureSettings();
  });

  it('plays a full round — guess, reveal, score, log — without touching FSRS', async () => {
    await seedHomophonePair();
    render(
      withAppProviders(
        <MemoryRouter>
          <HomophoneHuntGame signal="weak" />
        </MemoryRouter>,
      ),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));

    // Trial 1: guess Clip 1 for 箸 — right or wrong depends on the coin flip,
    // but either way a reveal with both measured contours should follow.
    await screen.findByText(/Which clip is/);
    fireEvent.click(screen.getByRole('button', { name: 'Clip 1' }));
    await screen.findByText(/Right — Clip|Actually Clip/);
    fireEvent.click(screen.getByRole('button', { name: 'Next pair' }));

    // Trial 2.
    await screen.findByText(/Which clip is/);
    fireEvent.click(screen.getByRole('button', { name: 'Clip 1' }));
    await screen.findByText(/Right — Clip|Actually Clip/);
    fireEvent.click(screen.getByRole('button', { name: 'See results' }));

    expect(await screen.findByText(/\/ 2 points/)).toBeInTheDocument();
    expect(screen.getByText(/of 2 correct/)).toBeInTheDocument();

    await waitFor(async () => expect(await getDb().gameRounds.count()).toBe(1));
    const [round] = await getDb().gameRounds.toArray();
    expect(round!.gameId).toBe('homophone-hunt');
    expect(round!.items).toHaveLength(2);
    expect(await getDb().reviews.count()).toBe(0);
    // The game is proficiency-agnostic and never writes a study item.
    expect(await getDb().studyItems.count()).toBe(0);
  });

  it('explains what it needs when there is no true homophone pair yet', async () => {
    await addVocabWithPitchAccent('voc-lonely', '箸', 'はし', 1);
    await addSentence('sent-lonely', '箸');
    await addAudioAndAlignment('audio-lonely', 'sent-lonely', '箸');
    await getDb().sentenceVocabulary.add({
      id: 'sv-lonely',
      sentenceId: 'sent-lonely',
      vocabularyItemId: 'voc-lonely',
      surfaceForm: '箸',
      createdAt: T,
      updatedAt: T,
    });
    await getDb().bookSentences.add({
      id: 'bs-lonely',
      bookId: 'book-x',
      sentenceId: 'sent-lonely',
      position: 0,
      createdAt: T,
      updatedAt: T,
    });

    render(
      withAppProviders(
        <MemoryRouter>
          <HomophoneHuntGame signal="weak" />
        </MemoryRouter>,
      ),
    );

    expect(await screen.findByText(/Needs two confirmed words/)).toBeInTheDocument();
  });
});
