import { describe, expect, it } from 'vitest';
import { planGrammarLinks, resolveGrammarPattern } from '../src/lib/grammarLinkApply';
import { normalizeGrammarPatternKey } from '../src/lib/grammarPatterns';

const pattern = (id: string, canonicalName: string, aliases: string[] = []) => ({
  id,
  canonicalName,
  normalizedKey: normalizeGrammarPatternKey(canonicalName),
  aliases,
});

const patterns = [
  pattern('te-iru', '～ている', ['～ています（現在進行）', '～てる']),
  pattern('wake', '～わけがない', ['訳がない']),
  pattern('state', '～ている（状態描写）'),
];

describe('resolveGrammarPattern', () => {
  it('matches the canonical name regardless of tilde style', () => {
    expect(resolveGrammarPattern('〜ている', patterns)).toBe('te-iru');
    expect(resolveGrammarPattern('ている', patterns)).toBe('te-iru');
  });

  it('matches a merged pattern through its aliases', () => {
    expect(resolveGrammarPattern('～てる', patterns)).toBe('te-iru');
    expect(resolveGrammarPattern('訳がない', patterns)).toBe('wake');
    expect(resolveGrammarPattern('〜ています（現在進行）', patterns)).toBe('te-iru');
  });

  it('matches ignoring a trailing gloss when that is unambiguous', () => {
    expect(resolveGrammarPattern('〜わけがない (impossible)', patterns)).toBe('wake');
  });

  it('prefers an exact key over a glossed look-alike and returns null for unknown or empty names', () => {
    expect(resolveGrammarPattern('～ている（状態描写）', patterns)).toBe('state');
    expect(resolveGrammarPattern('〜ようにする', patterns)).toBeNull();
    expect(resolveGrammarPattern('  〜 ', patterns)).toBeNull();
  });
});

describe('planGrammarLinks', () => {
  const sentence = '窓が開いていて、彼は食べてしまった。';

  it('resolves existing patterns, plans new ones, and computes spans', () => {
    const { planned, dropped } = planGrammarLinks(
      sentence,
      [
        { name: '〜ている', template: '', meaning: '', span: '開いていて', note: 'state' },
        { name: '〜てしまう', template: 'V-て + しまう', meaning: 'regret', span: '食べてしまった', note: 'done' },
      ],
      patterns,
    );
    expect(dropped).toEqual([]);
    expect(planned).toEqual([
      { patternId: 'te-iru', newPattern: null, start: 2, end: 7, surfaceForm: '開いていて', note: 'state' },
      {
        patternId: null,
        newPattern: { name: '〜てしまう', template: 'V-て + しまう', meaning: 'regret' },
        start: 10,
        end: 17,
        surfaceForm: '食べてしまった',
        note: 'done',
      },
    ]);
  });

  it('drops a span that is not in the sentence and keeps only the first span per pattern', () => {
    const { planned, dropped } = planGrammarLinks(
      sentence,
      [
        { name: '〜ている', template: '', meaning: '', span: '走っている', note: '' },
        { name: '〜てる', template: '', meaning: '', span: '開いて', note: 'first' },
        { name: '〜ている', template: '', meaning: '', span: '食べて', note: 'second' },
      ],
      patterns,
    );
    expect(dropped).toHaveLength(1);
    expect(planned).toHaveLength(1);
    expect(planned[0]!.note).toBe('first');
  });

  it('collapses the same new pattern named twice', () => {
    const { planned } = planGrammarLinks(
      sentence,
      [
        { name: '〜てしまう', template: '', meaning: '', span: '食べて', note: 'a' },
        { name: 'てしまう', template: '', meaning: '', span: '開いて', note: 'b' },
      ],
      patterns,
    );
    expect(planned).toHaveLength(1);
  });
});
