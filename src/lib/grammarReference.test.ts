import { describe, expect, it } from 'vitest';

import {
  buildGrammarDetector,
  wordSpansForDetection,
  buildReferenceIndex,
  detectableSegments,
  curatedGrammarByPattern,
  matchOwnPattern,
  normalizePatternKey,
  referenceKeys,
  type ReferencePattern,
} from './grammarReference';

describe('normalizePatternKey', () => {
  it('drops wave dashes, spaces, notes and punctuation', () => {
    expect(normalizePatternKey('～なくてもいい')).toBe('なくてもいい');
    expect(normalizePatternKey('〜なくてもいい')).toBe('なくてもいい');
    expect(normalizePatternKey('〜という（named）')).toBe('という');
    expect(normalizePatternKey('～なんですか? (explanation-seeking question)')).toBe('なんですか');
  });
});

describe('referenceKeys', () => {
  it('indexes slash variants and the kana reading', () => {
    const keys = referenceKeys({ pattern: '〜に対して / 〜に対する', reading: '〜にたいして' });
    expect(keys).toEqual(expect.arrayContaining(['に対して', 'に対する', 'にたいして']));
  });
});

describe('matchOwnPattern', () => {
  const te: ReferencePattern = { pattern: '〜てみる', level: 'N4' };
  const to1: ReferencePattern = { pattern: '〜という（named）', level: 'N4' };
  const to2: ReferencePattern = { pattern: '〜という（quote）', level: 'N4' };
  const index = buildReferenceIndex([te, to1, to2]);

  it('matches by canonical name across dash and note differences', () => {
    const match = matchOwnPattern({ id: 'p1', canonicalName: '～てみる (try doing)' }, index);
    expect(match?.entries).toEqual([te]);
    expect(match?.ambiguous).toBe(false);
  });

  it('matches by alias', () => {
    expect(matchOwnPattern({ id: 'p2', canonicalName: 'try', aliases: ['〜てみる'] }, index)?.entries).toEqual([te]);
  });

  it('flags a key that maps to several curated senses', () => {
    expect(matchOwnPattern({ id: 'p3', canonicalName: '〜という' }, index)?.ambiguous).toBe(true);
  });

  it('returns null for colloquial or sentence-specific patterns', () => {
    expect(matchOwnPattern({ id: 'p4', canonicalName: 'もう〜じゃん' }, index)).toBeNull();
  });
});

describe('curatedGrammarByPattern', () => {
  const te: ReferencePattern = { id: 'temiru', pattern: '〜てみる', level: 'N4' };
  const to1: ReferencePattern = { id: 'to-named', pattern: '〜という（named）', level: 'N4' };
  const to2: ReferencePattern = { id: 'to-quote', pattern: '〜という（quote）', level: 'N4' };
  const noId: ReferencePattern = { pattern: '〜ばかり', level: 'N4' };
  const index = buildReferenceIndex([te, to1, to2, noId]);

  it('maps unambiguous matches to the curated id and drops ambiguous, unmatched and id-less ones', () => {
    const map = curatedGrammarByPattern(
      [
        { id: 'p1', canonicalName: '～てみる' },
        { id: 'p2', canonicalName: '〜という' },
        { id: 'p3', canonicalName: 'もう〜じゃん' },
        { id: 'p4', canonicalName: '〜ばかり' },
      ],
      index,
    );
    expect([...map]).toEqual([['p1', 'temiru']]);
  });
});

describe('buildGrammarDetector', () => {
  const entries: ReferencePattern[] = [
    { id: 'takoto', pattern: '〜たことがある' },
    { id: 'tokoro', pattern: '〜ところ' },
    { id: 'tatokorode', pattern: '〜たところで' },
    { id: 'yarayara', pattern: '〜やら〜やら' },
    { id: 'wa', pattern: '〜は' },
    { id: 'nagara-a', pattern: '〜ながら（while）' },
    { id: 'nagara-b', pattern: '〜ながら（even though）' },
    { id: 'kono', pattern: 'この / その / あの / どの' },
  ];
  const detect = buildGrammarDetector(entries);

  it('finds an entry by its fixed text', () => {
    expect(detect('日本に行ったことがあります')).toEqual(['takoto']);
  });

  it('drops a match inside a longer entry match', () => {
    expect(detect('行ったところで無駄だ')).toEqual(['tatokorode']);
  });

  it('ignores a match that starts partway through a content word', () => {
    const detectShort = buildGrammarDetector([{ id: 'katta', pattern: '〜かった' }]);
    // 分かった: 分かっ is one word, so かった is not the い-adjective past.
    const token = (start: number, end: number, pos: string) => ({ start, end, pos, selectedByDefault: true });
    expect(detectShort('よく分かった')).toEqual(['katta']);
    expect(detectShort('よく分かった', wordSpansForDetection([token(2, 5, '動詞/一般')]))).toEqual([]);
    // い-adjectives carry their own inflection, so かった there is the real thing.
    expect(detectShort('楽しかった', wordSpansForDetection([token(0, 4, '形容詞/一般')]))).toEqual(['katta']);
  });

  it('needs both halves of a split pattern, in order', () => {
    expect(detect('泣くやら笑うやら大変だった')).toEqual(['yarayara']);
    expect(detect('やらなければ')).toEqual([]);
  });

  it('skips short literals and entries whose text is shared by several senses', () => {
    expect(detect('これは本です。この猫は走りながら食べる')).toEqual([]);
    expect(detectableSegments({ pattern: '〜は' })).toEqual([]);
  });

  it('applies per-entry guards to over-matches and tries the next occurrence', () => {
    const guarded = buildGrammarDetector([
      { id: 'naide', pattern: '〜ないで' },
      { id: 'rashii-typical-of', pattern: '〜らしい' },
      { id: 'ni-shite', pattern: '〜にして' },
      { id: 'koto-ni-wa', pattern: '〜ことには' },
    ]);
    expect(guarded('それは知らないです')).toEqual([]);
    expect(guarded('何も言わないで行った')).toEqual(['naide']);
    expect(guarded('それは素晴らしい')).toEqual([]);
    expect(guarded('彼は男らしい')).toEqual(['rashii-typical-of']);
    expect(guarded('家族を大切にしています')).toEqual([]);
    expect(guarded('驚いたことには誰もいなかった')).toEqual(['koto-ni-wa']);
    expect(guarded('見たことには気づかなかった')).toEqual([]);
    // A rejected first occurrence falls through to a later valid one.
    expect(guarded('知らないです、行かないで')).toEqual(['naide']);
  });

  it('resolves shared forms by context when every sense has a guard', () => {
    const senses = buildGrammarDetector([
      { id: 'nagara', pattern: '〜ながら（while）' },
      { id: 'nagara-mo', pattern: '〜ながら（も）' },
      { id: 'kurai-gurai', pattern: '〜くらい / 〜ぐらい（approximately）' },
      { id: 'kurai-gurai-extent', pattern: '〜くらい / 〜ぐらい（extent）' },
    ]);
    expect(senses('映像を見ながら聞く')).toEqual(['nagara']);
    expect(senses('羨ましいなと思いながらも')).toEqual(['nagara-mo']);
    expect(senses('残念ながら行けません')).toEqual([]);
    expect(senses('電車で30分ぐらいです')).toEqual(['kurai-gurai']);
    expect(senses('聞こえるぐらいで')).toEqual(['kurai-gurai-extent']);
    expect(senses('それくらいです')).toEqual([]);
  });
});
