import { describe, expect, it } from 'vitest';
import {
  formatGrammarPatternList,
  locateGrammarSpan,
  parseBookGrammarReply,
} from '../src/lib/grammarLinkReply';

describe('formatGrammarPatternList', () => {
  it('numbers patterns from P1 with template and aliases', () => {
    const lines = formatGrammarPatternList([
      { id: 'a', name: '〜ている', template: 'V-て + いる' },
      { id: 'b', name: '〜わけがない', aliases: ['訳がない'] },
    ]);
    expect(lines).toEqual(['P1 〜ている | V-て + いる', 'P2 〜わけがない | also: 訳がない']);
  });

  it('says so when no patterns are known', () => {
    expect(formatGrammarPatternList([])[0]).toMatch(/every pattern you report is NEW/);
  });
});

describe('parseBookGrammarReply', () => {
  const reply = [
    '=== Sentence 1 ===',
    'PATTERN: P2',
    'SPAN: 食べてしまった',
    'NOTE: regret',
    'PATTERN: NEW',
    'NAME: 〜ようにする',
    'TEMPLATE: V + ようにする',
    'MEANING: make a point of',
    'SPAN: 食べるようにして',
    'NOTE: habit',
    '=== Sentence 2 ===',
    'NONE',
    '=== Sentence 4 ===',
    'PATTERN: P9',
    'SPAN: 何か',
    'NOTE: out of range',
  ].join('\n');

  it('parses existing and new patterns, NONE, and missing sections', () => {
    const parsed = parseBookGrammarReply(reply, 4, 3);
    expect(parsed[0]).toEqual([
      { patternNumber: 2, span: '食べてしまった', note: 'regret' },
      {
        newPattern: { name: '〜ようにする', template: 'V + ようにする', meaning: 'make a point of' },
        span: '食べるようにして',
        note: 'habit',
      },
    ]);
    expect(parsed[1]).toEqual([]);
    expect(parsed[2]).toBeNull();
  });

  it('leaves a sentence as a candidate when every block is unusable', () => {
    expect(parseBookGrammarReply(reply, 4, 3)[3]).toBeNull();
  });

  it('rejects a NEW pattern with no name and a link with no span', () => {
    const parsed = parseBookGrammarReply(
      ['=== Sentence 1 ===', 'PATTERN: NEW', 'SPAN: x', 'PATTERN: P1', 'NOTE: n'].join('\n'),
      1,
      1,
    );
    expect(parsed[0]).toBeNull();
  });
});

describe('locateGrammarSpan', () => {
  it('finds a contiguous span', () => {
    expect(locateGrammarSpan('彼は全部食べてしまった。', '食べてしまった')).toEqual({
      start: 4,
      end: 11,
      surfaceForm: '食べてしまった',
    });
  });

  it('joins the parts of a discontinuous pattern in order', () => {
    const sentence = '読めば読むほど面白い。';
    expect(locateGrammarSpan(sentence, '読めば〜ほど')).toEqual({ start: 0, end: 7, surfaceForm: '読めば読むほど' });
  });

  it('drops a span that is not in the sentence or has parts out of order', () => {
    expect(locateGrammarSpan('私は行く。', '食べてしまった')).toBeNull();
    expect(locateGrammarSpan('ほど読めば', '読めば〜ほど')).toBeNull();
  });
});
