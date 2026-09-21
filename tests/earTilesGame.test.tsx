import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { EarTilesGame } from '../src/components/games/EarTilesGame';
import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { withAppProviders } from '../src/test/providers';

const T = '2026-09-21T00:00:00Z';
const PIECES: [string, string][] = [
  ['今日', '名詞/普通名詞/一般'],
  ['は', '助詞/係助詞'],
  ['友達', '名詞/普通名詞/一般'],
  ['と', '助詞/格助詞'],
  ['公園', '名詞/普通名詞/一般'],
  ['で', '助詞/格助詞'],
  ['遊び', '動詞/一般'],
  ['まし', '助動詞'],
  ['た', '助動詞'],
];
const TILES = ['今日は', '友達と', '公園で', '遊びました'];

async function seedSentence(id: string) {
  let cursor = 0;
  const tokens = PIECES.map(([surface, pos], i) => {
    const token = {
      id: `${id}-t${i}`,
      surface,
      start: cursor,
      end: cursor + surface.length,
      expression: surface,
      reading: surface,
      pos,
      source: 'morphology',
      selectedByDefault: false,
    };
    cursor += surface.length;
    return token;
  });
  const db = getDb();
  await db.sentences.add({
    id,
    normalizedKey: id,
    japanese: PIECES.map(([surface]) => surface).join(''),
    readingOnly: '',
    inlineReading: '',
    translation: `Translation of ${id}`,
    targetVocabulary: [],
    vocabularySuggestions: tokens as never,
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: T,
    updatedAt: T,
  });
  await db.analyses.put({
    sentenceId: id,
    chunks: [],
    notes: '',
    status: 'empty',
    formatVersion: 1,
    vocabularyReviewStatus: 'confirmed',
    vocabularySelections: [],
    grammarReviewStatus: 'unreviewed',
    createdAt: T,
    updatedAt: T,
  } as never);
  await db.sentenceAudio.add({
    id: `${id}-audio`,
    sentenceId: id,
    sourceId: 'src',
    sourceSentenceId: id,
    sourceTitle: 'Source',
    mimeType: 'audio/mpeg',
    durationMs: 3000,
    startMs: 0,
    endMs: 3000,
    blob: new Blob(['x']),
    importedAt: T,
  });
}

/** Tap tile buttons by their text; the bank buttons are the only ones with these exact labels. */
const tapTile = (text: string) => fireEvent.click(screen.getByRole('button', { name: text }));

describe('EarTilesGame', () => {
  beforeEach(async () => {
    resetDbForTests(`ear-tiles-${createId('db')}`);
    await ensureSettings();
  });

  it('judges each tile on the tap, costs a point per wrong tile, and logs the round without touching FSRS', async () => {
    for (const id of ['a', 'b', 'c', 'd']) await seedSentence(id);
    render(
      withAppProviders(
        <MemoryRouter>
          <EarTilesGame signal="weak" />
        </MemoryRouter>,
      ),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Worth 4 now')).toBeInTheDocument();

    // First sentence: one wrong tile (slot 1 wants 今日は), then the right order.
    tapTile('遊びました');
    expect(screen.getByText('Worth 3 now')).toBeInTheDocument();
    expect(screen.getByText(/Not 遊びました next/)).toBeInTheDocument();
    for (const tile of TILES) tapTile(tile);
    expect(await screen.findByText('3 / 4 points')).toBeInTheDocument();
    expect(screen.getByText(/you tried/)).toBeInTheDocument();

    // Remaining three sentences, clean.
    for (let round = 0; round < 3; round += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next sentence' }));
      for (const tile of TILES) tapTile(tile);
    }
    fireEvent.click(await screen.findByRole('button', { name: 'See results' }));

    expect(await screen.findByText('15 / 16 points')).toBeInTheDocument();
    await waitFor(async () => expect(await getDb().gameRounds.count()).toBe(1));
    const [round] = await getDb().gameRounds.toArray();
    expect(round!.gameId).toBe('ear-tiles');
    expect(round!.items).toHaveLength(4);
    expect(round!.items.reduce((sum, item) => sum + item.wrongGuesses, 0)).toBe(1);
    expect(await getDb().reviews.count()).toBe(0);
    expect(await getDb().studyItems.count()).toBe(0);
  });

  it('charges a point for peeking at the translation, and hides it until then', async () => {
    for (const id of ['a', 'b', 'c', 'd']) await seedSentence(id);
    render(
      withAppProviders(
        <MemoryRouter>
          <EarTilesGame signal="weak" />
        </MemoryRouter>,
      ),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await screen.findByText('Worth 4 now');
    expect(screen.queryByText(/^Translation of/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Peek at the translation/ }));
    expect(screen.getByText(/^Translation of/)).toBeInTheDocument();
    expect(screen.getByText('Worth 3 now')).toBeInTheDocument();
  });

  it('explains what it needs when there are too few playable sentences', async () => {
    await seedSentence('only');
    render(
      withAppProviders(
        <MemoryRouter>
          <EarTilesGame signal="weak" />
        </MemoryRouter>,
      ),
    );
    expect(await screen.findByText(/Needs at least 4 sentences/)).toBeInTheDocument();
  });
});
