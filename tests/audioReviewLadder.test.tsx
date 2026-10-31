import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { ensureStudyItem, getDb, logSentenceLearningEvent, updateSettings } from '../src/db/repository';
import type { Sentence, StudyItem, VocabularySuggestion } from '../src/domain/types';
import { ReviewPage } from '../src/pages/ReviewPage';
import { withAppProviders } from '../src/test/providers';

// Exercise the real review queue, tile UI and persistence. Browser specs cover playback.
vi.mock('../src/components/NativeAudioButton', () => ({
  NativeAudioButton: () => <button type="button">Play audio</button>,
}));

const pieces = [
  ['猫', 'ねこ', '名詞/普通名詞'], ['が', 'が', '助詞/格助詞'],
  ['魚', 'さかな', '名詞/普通名詞'], ['を', 'を', '助詞/格助詞'],
  ['食べ', 'たべ', '動詞/一般'], ['まし', 'まし', '助動詞'], ['た', 'た', '助動詞'],
] as const;

async function seed({ introduced = true, earState }: {
  introduced?: boolean;
  earState?: Partial<StudyItem['fsrsState']>;
} = {}) {
  const db = getDb();
  const now = new Date().toISOString();
  let cursor = 0;
  const vocabularySuggestions: VocabularySuggestion[] = pieces.map(([surface, reading, pos], index) => {
    const token = { id: `t${index}`, surface, reading, pos, expression: surface,
      start: cursor, end: cursor + surface.length, source: 'morphology' as const, selectedByDefault: false };
    cursor += surface.length;
    return token;
  });
  const sentence: Sentence = {
    id: 's', normalizedKey: 's', japanese: '猫が魚を食べました', readingOnly: 'ねこがさかなをたべました',
    inlineReading: '猫[ねこ]が魚[さかな]を食べ[たべ]ました', translation: 'The cat ate fish.',
    vocabularySuggestions, targetVocabulary: [], sourceReferences: [], conflicts: [],
    firstOccurrenceIndex: 0, importBatchIds: [], createdAt: now, updatedAt: now,
  };
  await db.books.put({ id: 'b', title: 'Audio lessons', chapters: [], updatedAt: now });
  await db.sentences.put(sentence);
  await db.bookSentences.put({ id: 'bs', bookId: 'b', sentenceId: 's', status: 'unstarted', position: 0, addedAt: now });
  await db.sentenceAudio.put({
    id: 'a', sentenceId: 's', sourceId: 'source', sourceSentenceId: 's', sourceTitle: 'Fixture',
    mimeType: 'audio/wav', blob: new Blob(['fixture']), durationMs: 3000, startMs: 0, endMs: 3000, importedAt: now,
  });
  if (introduced) {
    await logSentenceLearningEvent({ id: 'walk', visitId: 'v', sentenceId: 's', action: 'walkthrough_completed' });
    // Leave only the audio ladder due. No vocabulary confirmation or word cards.
    for (const activity of ['reading_in_context', 'listening']) {
      const item = await ensureStudyItem('sentence', 's', activity);
      await db.studyItems.update(item.id, {
        fsrsState: { ...item.fsrsState, state: 'review', due: '2099-01-01T00:00:00.000Z' },
      });
    }
  }
  if (earState) {
    const item = await ensureStudyItem('sentence', 's', 'ear_tiles');
    await db.studyItems.update(item.id, { fsrsState: { ...item.fsrsState, ...earState } });
  }
}

function openReview() {
  return render(withAppProviders(
    <MemoryRouter initialEntries={['/books/b/review']}>
      <Routes><Route path="/books/:bookId/review" element={<ReviewPage />} /></Routes>
    </MemoryRouter>,
  ));
}

beforeEach(async () => {
  resetDbForTests();
  await ensureSettings(); // Sentence-led flow stays on.
  await updateSettings({ dailyNewShadowCardQuota: 0 }); // Shadowing has its own describe below.
});

describe('sentence-led audio review ladder', () => {
  it('withholds audio cards until the sentence has been introduced', async () => {
    await seed({ introduced: false });
    openReview();
    await screen.findByText('No sentences to review here yet.');
    expect(await getDb().studyItems.count()).toBe(0);
  });

  it('seeds Ear Tiles without word cards, waits for self-rating, and keeps dictation locked', async () => {
    await seed();
    openReview();
    await screen.findByRole('button', { name: /^猫が(,|$)/ });
    expect(screen.queryByRole('button', { name: 'Good' })).not.toBeInTheDocument();
    for (const piece of ['猫が', '魚を', '食べました']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${piece}(,|$)`) }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Rate this card' }));
    expect(await getDb().reviews.count()).toBe(0);
    const good = await screen.findByRole('button', { name: 'Good' });
    fireEvent.click(good);
    fireEvent.click(good);
    await waitFor(async () => expect(await getDb().reviews.count()).toBe(1));
    const reviews = await getDb().reviews.toArray();
    const item = await getDb().studyItems.get(reviews[0]!.studyItemId);
    expect(item?.activityType).toBe('ear_tiles');
    expect(reviews[0]?.rating).toBe('good');
    expect((await getDb().studyItems.toArray()).some((row) => row.activityType.startsWith('dictation'))).toBe(false);
    expect(await getDb().studyItems.where('subjectType').equals('vocabularyItem').count()).toBe(0);
  });

  it('unlocks a single-phrase dictation, records the typed answer, and schedules only on self-rating', async () => {
    await seed({ earState: { state: 'review', reps: 2, due: '2099-01-01T00:00:00.000Z' } });
    openReview();
    const input = await screen.findByRole('textbox', { name: 'Type the missing phrase (kanji, kana or romaji)' });
    expect(screen.getByLabelText('Sentence with one phrase missing')).toHaveTextContent('＿＿魚を食べました');
    fireEvent.change(input, { target: { value: 'nekoga' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check', exact: true }));
    await screen.findByText('✓ Correct');
    expect(screen.getByText(/You typed:/)).toHaveTextContent('nekoga');
    expect(screen.getByText(/As kana:/)).toHaveTextContent('ねこが');
    expect(await getDb().reviews.count()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Hard' }));
    await waitFor(async () => expect(await getDb().reviews.count()).toBe(1));
    const review = (await getDb().reviews.toArray())[0]!;
    expect(review).toMatchObject({ rating: 'hard', responseRaw: 'nekoga', expectedAnswer: 'ねこが' });
    expect((await getDb().studyItems.get(review.studyItemId))?.activityType).toBe('dictation_tile:0');
    expect((await getDb().studyItems.toArray()).filter((row) => row.activityType.startsWith('dictation'))
      .every((row) => /^dictation_tile:[012]$/.test(row.activityType))).toBe(true);
  });

  describe('daily audio top-up', () => {
    // A due listening card keeps the queue busy, so only the top-up can introduce Ear Tiles.
    async function seedBusyQueue() {
      await seed();
      const listening = await ensureStudyItem('sentence', 's', 'listening');
      await getDb().studyItems.update(listening.id, {
        fsrsState: { ...listening.fsrsState, state: 'review', due: '2026-01-02T00:00:00.000Z' },
      });
    }
    const earTiles = () =>
      getDb().studyItems.where('subjectId').equals('s').and((row) => row.activityType === 'ear_tiles').toArray();

    it('introduces Ear Tiles at open even while another card is due', async () => {
      await seedBusyQueue();
      openReview();
      await screen.findByRole('button', { name: 'Reveal text' });
      await waitFor(async () => expect(await earTiles()).toHaveLength(1));
    });

    it('introduces an introduced sentence’s reading_in_context card while the queue is busy, unless switched off', async () => {
      await seedBusyQueue();
      const reading = () =>
        getDb().studyItems.where('subjectId').equals('s').and((row) => row.activityType === 'reading_in_context').toArray();
      await getDb().studyItems.bulkDelete((await reading()).map((row) => row.id));
      await updateSettings({ dailyNewSentenceCardQuota: 0 });
      const first = openReview();
      await screen.findByRole('button', { name: 'Reveal text' });
      expect(await reading()).toHaveLength(0);
      first.unmount();

      await updateSettings({ dailyNewSentenceCardQuota: 1 });
      openReview();
      await screen.findByRole('button', { name: 'Reveal text' });
      await waitFor(async () => expect(await reading()).toHaveLength(1));
    });

    it('introduces nothing while the queue is busy when switched off', async () => {
      await seedBusyQueue();
      await updateSettings({ dailyNewAudioCardQuota: 0 });
      openReview();
      await screen.findByRole('button', { name: 'Reveal text' });
      expect(await earTiles()).toHaveLength(0);
    });
  });

  it('withholds an existing due dictation card while Ear Tiles is relearning', async () => {
    await seed({ earState: { state: 'relearning', reps: 3, due: '2099-01-01T00:00:00.000Z' } });
    await ensureStudyItem('sentence', 's', 'dictation_tile:0');
    openReview();
    await screen.findByText('All caught up.');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(await getDb().reviews.count()).toBe(0);
  });
});

describe('shadowing review card', () => {
  const shadowingItems = () =>
    getDb().studyItems.where('subjectId').equals('s').and((row) => row.activityType === 'shadowing').toArray();
  // Everything else is parked far in the future (Ear Tiles only once reviewed, so dictation stays locked).
  const parkEarTiles = { state: 'review' as const, reps: 1, due: '2099-01-01T00:00:00.000Z' };
  // A due listening card keeps the queue busy, so only the top-up can introduce the shadowing card.
  async function makeQueueBusy() {
    const listening = await ensureStudyItem('sentence', 's', 'listening');
    await getDb().studyItems.update(listening.id, {
      fsrsState: { ...listening.fsrsState, state: 'review', due: '2026-01-02T00:00:00.000Z' },
    });
  }

  it('is introduced by the daily top-up, and not when switched off', async () => {
    await seed({ earState: parkEarTiles });
    await makeQueueBusy();
    const off = openReview();
    await screen.findByRole('button', { name: 'Reveal text' });
    expect(await shadowingItems()).toHaveLength(0);
    off.unmount();

    await updateSettings({ dailyNewShadowCardQuota: 1 });
    openReview();
    await screen.findByRole('button', { name: 'Reveal text' });
    await waitFor(async () => expect(await shadowingItems()).toHaveLength(1));
  });

  it('shows Record and withholds the rating buttons until a take exists', async () => {
    await seed({ earState: parkEarTiles });
    const item = await ensureStudyItem('sentence', 's', 'shadowing');
    await getDb().studyItems.update(item.id, {
      fsrsState: { ...item.fsrsState, state: 'review', due: '2026-01-02T00:00:00.000Z' },
    });
    openReview();
    await screen.findByRole('button', { name: 'Record' });
    expect(screen.queryByRole('button', { name: 'Good' })).not.toBeInTheDocument();
    expect(await getDb().reviews.count()).toBe(0);
  });

  it('is withheld for sentences not yet introduced', async () => {
    await seed({ introduced: false });
    await updateSettings({ dailyNewShadowCardQuota: 5 });
    openReview();
    await screen.findByText('No sentences to review here yet.');
    expect(await shadowingItems()).toHaveLength(0);
  });

  it('is withheld in quiet mode, even when already due', async () => {
    await seed({ earState: parkEarTiles });
    const item = await ensureStudyItem('sentence', 's', 'shadowing');
    await getDb().studyItems.update(item.id, {
      fsrsState: { ...item.fsrsState, state: 'review', due: '2026-01-02T00:00:00.000Z' },
    });
    await updateSettings({ quietMode: true });
    openReview();
    await screen.findByText('All caught up.');
    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument();
  });
});
