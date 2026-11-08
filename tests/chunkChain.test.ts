import { describe, expect, it } from 'vitest';

import type { Sentence, VocabularySuggestion, WordAlignment } from '../src/domain/types';
import { MAX_RUNGS, MIN_RUNGS, planChunkChain } from '../src/lib/chunkChain';

type Piece = [surface: string, pos: string];

function sentence(pieces: Piece[]): Pick<Sentence, 'japanese' | 'vocabularySuggestions'> {
  let cursor = 0;
  const suggestions: VocabularySuggestion[] = pieces.map(([surface, pos], i) => {
    const token: VocabularySuggestion = {
      id: `t${i}`,
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
  return { japanese: pieces.map((p) => p[0]).join(''), vocabularySuggestions: suggestions };
}

/** One aligned word per entry: [text, startSeconds, endSeconds]. */
function alignment(words: [string, number, number][]): WordAlignment[] {
  return words.map(([text, start, end]) => ({ text, start, end, phones: [] }));
}

const NOUN = '名詞/普通名詞';
const PARTICLE = '助詞/格助詞';

// 私は|昨日、|友達と|駅で|映画を|見ました。 spoken over 5.4 s.
const SPOKEN = sentence([
  ['私', NOUN],
  ['は', '助詞/係助詞'],
  ['昨日', NOUN],
  ['、', '補助記号/読点'],
  ['友達', NOUN],
  ['と', PARTICLE],
  ['駅', NOUN],
  ['で', PARTICLE],
  ['映画', NOUN],
  ['を', PARTICLE],
  ['見', '動詞/一般'],
  ['まし', '助動詞'],
  ['た', '助動詞'],
  ['。', '補助記号/句点'],
]);
const SPOKEN_ALIGNMENT = alignment([
  ['私', 0, 0.4],
  ['は', 0.4, 0.6],
  ['昨日', 0.8, 1.6],
  ['友達', 1.8, 2.4],
  ['と', 2.4, 2.6],
  ['駅', 2.8, 3.2],
  ['で', 3.2, 3.4],
  ['映画', 3.6, 4.2],
  ['を', 4.2, 4.4],
  ['見', 4.6, 4.8],
  ['まし', 4.8, 5.2],
  ['た', 5.2, 5.4],
]);

describe('planChunkChain', () => {
  it('sizes rungs by duration and ends with the whole sentence', () => {
    const plan = planChunkChain(SPOKEN, SPOKEN_ALIGNMENT);
    expect(plan.rejection).toBeNull();
    expect(plan.rungs.map((rung) => rung.text)).toEqual(['映画を見ました', '友達と駅で映画を見ました', '私は昨日友達と駅で映画を見ました']);
    expect(plan.rungs.map((rung) => rung.whole)).toEqual([false, false, true]);
    // Every rung ends where the speech ends; each starts at its first chunk's first word.
    expect(plan.rungs.map((rung) => rung.startMs)).toEqual([3600, 1800, 0]);
    expect(plan.rungs.every((rung) => rung.endMs === 5400)).toBe(true);
  });

  it('adds at least a step of new audio at every rung', () => {
    const { rungs } = planChunkChain(SPOKEN, SPOKEN_ALIGNMENT);
    const spans = rungs.map((rung) => rung.endMs - rung.startMs);
    for (let i = 1; i < spans.length; i += 1) expect(spans[i]! - spans[i - 1]!).toBeGreaterThanOrEqual(1200);
  });

  it('never exceeds MAX_RUNGS however many chunks a long sentence has', () => {
    const pieces: Piece[] = [];
    const words: [string, number, number][] = [];
    for (let i = 0; i < 16; i += 1) {
      pieces.push(['犬', NOUN], ['は', '助詞/係助詞']);
      words.push(['犬', i * 0.8, i * 0.8 + 0.5], ['は', i * 0.8 + 0.5, i * 0.8 + 0.8]);
    }
    const plan = planChunkChain(sentence(pieces), alignment(words));
    expect(plan.rejection).toBeNull();
    expect(plan.rungs.length).toBeLessThanOrEqual(MAX_RUNGS);
    expect(plan.rungs.length).toBeGreaterThanOrEqual(MIN_RUNGS);
    expect(plan.rungs[plan.rungs.length - 1]!.whole).toBe(true);
  });

  it('rejects a sentence too short to have two rungs below the whole sentence', () => {
    const short = sentence([
      ['猫', NOUN],
      ['が', PARTICLE],
      ['鳴き', '動詞/一般'],
      ['まし', '助動詞'],
      ['た', '助動詞'],
    ]);
    const plan = planChunkChain(
      short,
      alignment([
        ['猫', 0, 0.3],
        ['が', 0.3, 0.4],
        ['鳴き', 0.5, 0.8],
        ['まし', 0.8, 1.0],
        ['た', 1.0, 1.1],
      ]),
    );
    expect(plan).toEqual({ rungs: [], rejection: 'too-short' });
  });

  it('rejects a sentence whose stored tokens do not chunk', () => {
    const plan = planChunkChain({ japanese: '私は走る', vocabularySuggestions: [] }, SPOKEN_ALIGNMENT);
    expect(plan).toEqual({ rungs: [], rejection: 'no-chunks' });
  });

  it('falls back when the aligner cannot place the chunks', () => {
    const withUnk = alignment([
      ['私', 0, 0.4],
      ['は', 0.4, 0.6],
      ['<unk>', 0.8, 3.2],
      ['で', 3.2, 3.4],
      ['映画', 3.6, 4.2],
      ['を', 4.2, 4.4],
      ['見', 4.6, 4.8],
      ['まし', 4.8, 5.2],
      ['た', 5.2, 5.4],
    ]);
    expect(planChunkChain(SPOKEN, withUnk)).toEqual({ rungs: [], rejection: 'unreliable-alignment' });
    expect(planChunkChain(SPOKEN, [])).toEqual({ rungs: [], rejection: 'unreliable-alignment' });
  });
});
