import { describe, expect, it } from 'vitest';
import {
  NO_AUTO_LINK_FAMILY,
  formatGrammarPatternList,
  linkablePatterns,
  locateGrammarSpan,
  parseBookGrammarReply,
} from '../src/lib/grammarLinkReply';

describe('formatGrammarPatternList', () => {
  it('lists name, template and aliases, one pattern per line', () => {
    const lines = formatGrammarPatternList([
      { id: 'a', name: '〜ている', template: 'V-て + いる' },
      { id: 'b', name: '〜わけがない', aliases: ['訳がない'] },
      { id: 'c', name: '〜ましょう' },
    ]);
    expect(lines).toEqual(['〜ている | V-て + いる', '〜わけがない | also: 訳がない', '〜ましょう']);
  });

  it('says so when no patterns are known', () => {
    expect(formatGrammarPatternList([])[0]).toMatch(/every pattern you report is new/);
  });
});

describe('linkablePatterns', () => {
  it('drops patterns tagged no-auto-link and keeps untagged or other families', () => {
    const kept = linkablePatterns([
      { id: 'a', family: null },
      { id: 'b', family: NO_AUTO_LINK_FAMILY },
      { id: 'c', family: 'conditionals' },
      { id: 'd' },
    ]);
    expect(kept.map((p) => p.id)).toEqual(['a', 'c', 'd']);
  });
});

describe('parseBookGrammarReply', () => {
  const reply = [
    '=== Sentence 1 ===',
    'PATTERN: 〜てしまう',
    'SPAN: 食べてしまった',
    'NOTE: regret',
    'PATTERN: 〜ようにする',
    'TEMPLATE: V + ようにする',
    'MEANING: make a point of',
    'SPAN: 食べるようにして',
    'NOTE: habit',
    '=== Sentence 2 ===',
    'NONE',
    '=== Sentence 4 ===',
    'PATTERN: 〜ている',
    'NOTE: no span, so unusable',
  ].join('\n');

  it('parses links, NONE, and missing sections', () => {
    const parsed = parseBookGrammarReply(reply, 4);
    expect(parsed[0]).toEqual([
      { name: '〜てしまう', template: '', meaning: '', span: '食べてしまった', note: 'regret' },
      { name: '〜ようにする', template: 'V + ようにする', meaning: 'make a point of', span: '食べるようにして', note: 'habit' },
    ]);
    expect(parsed[1]).toEqual([]);
    expect(parsed[2]).toBeNull();
  });

  it('leaves a sentence as a candidate when every block is unusable', () => {
    expect(parseBookGrammarReply(reply, 4)[3]).toBeNull();
  });

  it('accepts fullwidth colons and keeps a usable block next to an unusable one', () => {
    const parsed = parseBookGrammarReply(
      ['=== Sentence 1 ===', 'PATTERN： 〜ながら', 'SPAN： 歩きながら', 'PATTERN: 〜たい', 'NOTE: n'].join('\n'),
      1,
    );
    expect(parsed[0]).toEqual([{ name: '〜ながら', template: '', meaning: '', span: '歩きながら', note: '' }]);
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
