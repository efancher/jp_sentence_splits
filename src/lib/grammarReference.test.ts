import { describe, expect, it } from 'vitest';

import {
  buildReferenceIndex,
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
