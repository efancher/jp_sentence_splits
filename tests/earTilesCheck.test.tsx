import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EarTilesCheck } from '../src/components/EarTilesCheck';
import type { SentenceAudio, VocabularySuggestion } from '../src/domain/types';
import { buildCheckPuzzle } from '../src/lib/earTiles';
import { withAppProviders } from '../src/test/providers';

const PIECES: [string, string][] = [
  ['私', '代名詞'],
  ['は', '助詞/係助詞'],
  ['猫', '名詞/普通名詞/一般'],
  ['が', '助詞/格助詞'],
  ['魚', '名詞/普通名詞/一般'],
  ['を', '助詞/格助詞'],
  ['食べ', '動詞/一般'],
  ['まし', '助動詞'],
  ['た', '助動詞'],
];

function makeSentence() {
  let cursor = 0;
  const tokens: VocabularySuggestion[] = PIECES.map(([surface, pos], i) => {
    const token = {
      id: `t${i}`, surface, start: cursor, end: cursor + surface.length, expression: surface, reading: surface,
      pos, source: 'morphology', selectedByDefault: false,
    } as VocabularySuggestion;
    cursor += surface.length;
    return token;
  });
  return { id: 's1', japanese: PIECES.map(([s]) => s).join(''), vocabularySuggestions: tokens };
}

const audio = { id: 'a1', sentenceId: 's1', mimeType: 'audio/mpeg', durationMs: 1000, startMs: 0, endMs: 1000, blob: new Blob() } as unknown as SentenceAudio;

function setup() {
  const puzzle = buildCheckPuzzle(makeSentence(), 'seed')!;
  const onRecord = vi.fn();
  const onFinish = vi.fn();
  render(withAppProviders(<EarTilesCheck sentenceId="s1" visitId="v1" puzzle={puzzle} audio={audio} onRecord={onRecord} onFinish={onFinish} />));
  return { puzzle, onRecord, onFinish };
}

const tap = (text: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${text}(,|$)`) }));

describe('EarTilesCheck', () => {
  it('logs a clean particle result when the learner never taps the fake', () => {
    const { puzzle, onRecord, onFinish } = setup();
    for (const text of puzzle.answer) tap(text);
    expect(screen.getByText(/Heard it cleanly/)).toBeInTheDocument();
    const particleFakes = puzzle.bank.filter((t) => t.distractor?.kind === 'particle');
    expect(onRecord).toHaveBeenCalledTimes(particleFakes.length);
    for (const call of onRecord.mock.calls) {
      expect(call[0]).toMatchObject({ skill: 'particle', firstCorrect: true, outcome: 'independent_correct', levelShown: 4 });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Continue to the walkthrough' }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('strikes out a tapped fake, logs it as a miss, and still lets the learner finish', () => {
    const { puzzle, onRecord } = setup();
    const fake = puzzle.bank.find((t) => t.distractor?.kind === 'particle')!;
    tap(fake.text);
    expect(screen.getByRole('button', { name: `${fake.text}, not in the sentence` })).toBeDisabled();
    for (const text of puzzle.answer) tap(text);
    expect(screen.getByText(/1 slip/)).toBeInTheDocument();
    const missed = onRecord.mock.calls.map((c) => c[0]).filter((d) => d.targetText === fake.distractor!.from);
    expect(missed).toHaveLength(1);
    expect(missed[0]).toMatchObject({ firstCorrect: false, outcome: 'assisted_correct' });
  });

  it('never logs an unresolved outcome, so a miss cannot park the sentence or lower the support level', () => {
    const { puzzle, onRecord } = setup();
    for (const fake of puzzle.bank.filter((t) => t.distractor)) tap(fake.text);
    for (const text of puzzle.answer) tap(text);
    expect(onRecord.mock.calls.every((c) => c[0].outcome !== 'unresolved')).toBe(true);
  });
});
