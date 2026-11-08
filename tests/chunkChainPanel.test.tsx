import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChunkChainPanel } from '../src/components/ChunkChainPanel';
import { resetDbForTests } from '../src/db/database';
import { getDb } from '../src/db/repository';
import { CHAIN_RUNG_KEY_PREFIX } from '../src/lib/chunkChainSession';
import { createId } from '../src/lib/ids';
import { PHRASE_SHADOW_KEY_PREFIX } from '../src/lib/phraseShadow';

// 私は昨日、友達と駅で映画を見ました。 spoken over 5.4 s: the planner gives rungs
// 映画を見ました (3.6 s) / 友達と駅で映画を見ました (1.8 s) / the whole sentence (0 s).
const PIECES: [string, string][] = [
  ['私', '名詞/普通名詞'], ['は', '助詞/係助詞'], ['昨日', '名詞/普通名詞'], ['、', '補助記号/読点'],
  ['友達', '名詞/普通名詞'], ['と', '助詞/格助詞'], ['駅', '名詞/普通名詞'], ['で', '助詞/格助詞'],
  ['映画', '名詞/普通名詞'], ['を', '助詞/格助詞'], ['見', '動詞/一般'], ['まし', '助動詞'], ['た', '助動詞'], ['。', '補助記号/句点'],
];
const WORDS = [
  ['私', 0, 0.4], ['は', 0.4, 0.6], ['昨日', 0.8, 1.6], ['友達', 1.8, 2.4], ['と', 2.4, 2.6], ['駅', 2.8, 3.2],
  ['で', 3.2, 3.4], ['映画', 3.6, 4.2], ['を', 4.2, 4.4], ['見', 4.6, 4.8], ['まし', 4.8, 5.2], ['た', 5.2, 5.4],
] as const;

async function seed() {
  let cursor = 0;
  const vocabularySuggestions = PIECES.map(([surface, pos], i) => {
    const token = { id: `t${i}`, surface, start: cursor, end: cursor + surface.length, expression: surface, reading: surface, pos, source: 'morphology', selectedByDefault: false };
    cursor += surface.length;
    return token;
  });
  const db = getDb();
  await db.sentences.put({ id: 's1', japanese: PIECES.map((p) => p[0]).join(''), vocabularySuggestions } as never);
  await db.referenceAlignments.put({
    id: 'a1', alignmentVersion: 1, computedAt: '2026-11-08T00:00:00.000Z',
    result: { durationSeconds: 5.4, words: WORDS.map(([text, start, end]) => ({ text, start, end, phones: [] })) },
  });
}

describe('ChunkChainPanel', () => {
  beforeEach(() => {
    resetDbForTests(`chunk-chain-${createId('db')}`);
  });

  it('walks the rungs, points the loop at each, and logs rung events plus one weighted summary', async () => {
    await seed();
    const user = userEvent.setup();
    const onRange = vi.fn();
    render(<ChunkChainPanel bookId="b1" sentenceId="s1" sentenceAudioId="a1" onRange={onRange} />);

    await user.click(await screen.findByRole('button', { name: 'Chunk chain' }));
    expect(screen.getByText('映画を見ました')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull(); // first step is never rated
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('友達と駅で映画を見ました')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(await screen.findByText('私は昨日友達と駅で映画を見ました')).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Got it' }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(await screen.findByText('You got the whole sentence.')).toBeTruthy();

    expect(onRange).toHaveBeenCalledWith({ startMs: 3600, endMs: 5400 });
    expect(onRange).toHaveBeenCalledWith({ startMs: 1800, endMs: 5400 });
    expect(onRange).toHaveBeenCalledWith({ startMs: 0, endMs: 5400 });
    expect(onRange).toHaveBeenLastCalledWith(null);

    await waitFor(async () => expect(await getDb().sentenceLearningEvents.count()).toBe(3));
    const events = await getDb().sentenceLearningEvents.toArray();
    const rungEvents = events.filter((e) => e.target?.key?.startsWith(CHAIN_RUNG_KEY_PREFIX));
    const summary = events.filter((e) => e.target?.key?.startsWith(PHRASE_SHADOW_KEY_PREFIX));
    expect(rungEvents).toHaveLength(2);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ action: 'phrase_shadow', outcome: 'got_it', rangeStartMs: 0, rangeEndMs: 5400, assessmentSource: 'self' });
    expect(await getDb().reviews.count()).toBe(0);
  });

  it('drops a rung on Not yet and logs no summary when nothing was Got it', async () => {
    await seed();
    const user = userEvent.setup();
    render(<ChunkChainPanel bookId="b1" sentenceId="s1" sentenceAudioId="a1" onRange={() => undefined} />);
    await user.click(await screen.findByRole('button', { name: 'Chunk chain' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Not yet' }));
    expect(await screen.findByRole('button', { name: 'Next' })).toBeTruthy(); // back on the unrated first rung
    await user.click(screen.getByRole('button', { name: 'Stop chain' }));
    const events = await getDb().sentenceLearningEvents.toArray();
    expect(events).toHaveLength(1);
    expect(events[0]!.target?.key?.startsWith(CHAIN_RUNG_KEY_PREFIX)).toBe(true);
  });

  it('renders nothing when the sentence has no usable chain', async () => {
    const { container } = render(<ChunkChainPanel bookId="b1" sentenceId="missing" sentenceAudioId="none" onRange={() => undefined} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.textContent).toBe('');
  });
});
