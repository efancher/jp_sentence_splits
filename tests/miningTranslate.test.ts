import { describe, expect, it } from 'vitest';

import {
  formatRowsForTranslationAI,
  parseAiTranslations,
} from '../src/lib/miningTranslate';

describe('formatRowsForTranslationAI', () => {
  it('numbers every sentence and shows the current draft or (none)', () => {
    const prompt = formatRowsForTranslationAI([
      { japanese: 'どうも、よかったら続けてください。', translation: 'Hello there.' },
      { japanese: 'さあ、今日も早速参りましょう。', translation: '' },
    ]);
    expect(prompt).toContain('1. どうも、よかったら続けてください。\n   current: Hello there.');
    expect(prompt).toContain('2. さあ、今日も早速参りましょう。\n   current: (none)');
  });
});

describe('parseAiTranslations', () => {
  it('maps numbered lines back onto rows by number', () => {
    const out = parseAiTranslations(
      ['1. Hello, please go ahead.', '2. Now, let us get started right away.'].join('\n'),
      2,
    );
    expect(out).toEqual(['Hello, please go ahead.', 'Now, let us get started right away.']);
  });

  it('leaves rows the reply skipped as null', () => {
    const out = parseAiTranslations('2. Only the second one.', 3);
    expect(out).toEqual([null, 'Only the second one.', null]);
  });

  it('tolerates ) : and - separators and extra whitespace', () => {
    const out = parseAiTranslations(
      ['1) first', '  2:   second  ', '3 - third'].join('\n'),
      3,
    );
    expect(out).toEqual(['first', 'second', 'third']);
  });

  it('folds an unnumbered wrapped line into the previous translation', () => {
    const out = parseAiTranslations(
      ['1. This sentence runs on', 'across two lines.', '2. Second.'].join('\n'),
      2,
    );
    expect(out).toEqual(['This sentence runs on across two lines.', 'Second.']);
  });

  it('treats an out-of-range leading number as a continuation, not a row', () => {
    const out = parseAiTranslations(
      ['1. It cost', '1000 yen in total.'].join('\n'),
      2,
    );
    expect(out).toEqual(['It cost 1000 yen in total.', null]);
  });

  it('ignores echoed "current:" lines', () => {
    const out = parseAiTranslations(
      ['1. Fixed translation.', '   current: old draft', '2. Second.'].join('\n'),
      2,
    );
    expect(out).toEqual(['Fixed translation.', 'Second.']);
  });

  it('returns all-null when nothing parses', () => {
    expect(parseAiTranslations('no numbers here\njust prose', 2)).toEqual([null, null]);
  });
});
