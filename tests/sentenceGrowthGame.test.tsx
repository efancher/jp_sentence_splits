import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { SentenceGrowthGame } from '../src/components/games/SentenceGrowthGame';
import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb, updateSettings } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { withAppProviders } from '../src/test/providers';

const T = '2026-10-17T00:00:00Z';
// 親鳥がひなに巣を作りました。 — asked in the order が → を → に
const PIECES: [string, string][] = [
  ['親', '名詞/普通名詞'], ['鳥', '名詞/普通名詞'], ['が', '助詞/格助詞'],
  ['ひな', '名詞/普通名詞'], ['に', '助詞/格助詞'],
  ['巣', '名詞/普通名詞'], ['を', '助詞/格助詞'],
  ['作り', '動詞/一般'], ['まし', '助動詞'], ['た', '助動詞'], ['。', '補助記号'],
];

async function seedSentence(id: string) {
  let cursor = 0;
  const tokens = PIECES.map(([surface, pos], i) => {
    const token = {
      id: `${id}-t${i}`, surface, start: cursor, end: cursor + surface.length, expression: surface,
      reading: surface, pos, source: 'morphology', selectedByDefault: false,
    };
    cursor += surface.length;
    return token;
  });
  const db = getDb();
  await db.sentences.add({
    id, normalizedKey: id, japanese: PIECES.map(([s]) => s).join(''), readingOnly: '', inlineReading: '',
    translation: `Translation of ${id}`, targetVocabulary: [], vocabularySuggestions: tokens as never,
    sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0, importBatchIds: [], createdAt: T, updatedAt: T,
  });
  await db.sentenceAudio.add({
    id: `${id}-audio`, sentenceId: id, sourceId: 'src', sourceSentenceId: id, sourceTitle: 'Source',
    mimeType: 'audio/mpeg', durationMs: 3000, startMs: 0, endMs: 3000, blob: new Blob(['x']), importedAt: T,
  });
}

const tap = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

describe('SentenceGrowthGame', () => {
  beforeEach(async () => {
    resetDbForTests(`sentence-growth-${createId('db')}`);
    await ensureSettings();
    // Introduced via the flow-off rule (no linked words → vacuously met).
    await updateSettings({ sentenceLedFlow: false });
  });

  it('asks who, what, then to whom; a wrong pick is counted; the learner self-rates; the round is logged without touching FSRS', async () => {
    for (const id of ['a', 'b', 'c']) await seedSentence(id);
    render(
      withAppProviders(
        <MemoryRouter>
          <SentenceGrowthGame signal="weak" />
        </MemoryRouter>,
      ),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));

    // Only the core is visible at first; the answers are on buttons, not in the sentence.
    expect(await screen.findByText('Who or what does it?')).toBeInTheDocument();
    expect(screen.getAllByText('＿＿')).toHaveLength(3);
    expect(screen.getByText('作りました。')).toBeInTheDocument();

    // First sentence: one wrong pick, then the right order.
    tap('巣を');
    expect(screen.getByText(/isn’t the answer to that question/)).toBeInTheDocument();
    tap('親鳥が');
    expect(await screen.findByText('What is the action done to?')).toBeInTheDocument();
    tap('巣を');
    expect(await screen.findByText('Where to, when, or to whom?')).toBeInTheDocument();
    tap('ひなに');

    // Say-aloud step has exactly one control; rating is the learner's own choice.
    expect(await screen.findByText('Now say the whole sentence out loud')).toBeInTheDocument();
    tap(/I’ve said it/);
    // The reveal shows the native sentence and its translation only after the say-aloud step.
    expect(screen.getByText(/^Translation of [abc]$/)).toBeInTheDocument();
    tap('Hard');
    tap('Next sentence');

    for (let round = 0; round < 2; round += 1) {
      for (const piece of ['親鳥が', '巣を', 'ひなに']) tap(piece);
      tap(/I’ve said it/);
      tap('Easy');
      tap(round === 0 ? 'Next sentence' : 'See results');
    }

    await waitFor(async () => expect(await getDb().gameRounds.count()).toBe(1));
    const [round] = await getDb().gameRounds.toArray();
    expect(round!.gameId).toBe('sentence-growth');
    expect(round!.items.map((item) => item.selfRating).sort()).toEqual(['easy', 'easy', 'hard']);
    expect(round!.items.reduce((sum, item) => sum + item.wrongGuesses, 0)).toBe(1);
    expect(await getDb().reviews.count()).toBe(0);
    expect(await getDb().studyItems.count()).toBe(0);
  });

  it('explains what it needs when there are too few playable sentences', async () => {
    await seedSentence('only');
    render(
      withAppProviders(
        <MemoryRouter>
          <SentenceGrowthGame signal="weak" />
        </MemoryRouter>,
      ),
    );
    expect(await screen.findByText(/Needs at least 3 sentences/)).toBeInTheDocument();
  });
});
