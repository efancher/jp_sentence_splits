import { describe, expect, it } from 'vitest';

import {
  blindSheet,
  categoriesOf,
  checkReply,
  pickWindows,
  summarize,
  windowPrompt,
  type EvalResult,
} from './assistModelEval';

const line = (japanese: string) => ({ japanese, translation: 'tr' });
const plain = (n: number) => Array.from({ length: n }, (_, i) => line(`今日は天気${i}です。`));

describe('categoriesOf', () => {
  it('flags passive, causative and fragments', () => {
    expect(categoriesOf('先生に怒られた。')).toContain('passive/potential');
    expect(categoriesOf('子供に野菜を食べさせる。')).toContain('causative');
    expect(categoriesOf('はい。')).toContain('fragment');
  });
});

describe('pickWindows', () => {
  it('takes consecutive 10-sentence windows, richest first, capped per source', () => {
    const rich = [...plain(10), ...Array.from({ length: 10 }, () => line('先生に怒られて、子供に食べさせる。')), ...plain(10)];
    const windows = pickWindows(
      [
        { source: 'a', sentences: rich },
        { source: 'b', sentences: plain(10) },
      ],
      3,
      1,
    );
    expect(windows.map((w) => w.id)).toEqual(['a#10', 'b#0']);
    expect(windows[0]!.sentences.map((s) => s.handle)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('skips windows with an untranslated sentence', () => {
    const sentences = [...plain(9), { japanese: 'あ', translation: ' ' }];
    expect(pickWindows([{ source: 'a', sentences }], 1)).toEqual([]);
  });
});

describe('windowPrompt / checkReply', () => {
  const [window] = pickWindows([{ source: 'a', sentences: plain(10) }], 1);

  it('builds a prompt over the window and validates the reply against its last handle', () => {
    expect(windowPrompt(window!, 'structure')).toContain('S10');
    expect(checkReply(window!, 'structure', 'S1 | x')).toMatch(/stop before S10/);
    expect(checkReply(window!, 'structure', 'S1 | x\nS10 | y')).toBeNull();
  });
});

describe('summarize / blindSheet', () => {
  const row = (arm: string, ok: boolean, seconds: number, reply: string | null = 'text'): EvalResult => ({
    window: 'a#0',
    kind: 'structure',
    arm,
    ok,
    seconds,
    problem: ok ? null : 'bad',
    reply,
  });

  it('summarizes pass rate and median latency per arm', () => {
    expect(summarize([row('x', true, 4), row('x', false, 8), row('y', true, 2)])).toEqual([
      { arm: 'x', runs: 2, passed: 1, failed: 1, passRate: 0.5, medianSeconds: 8 },
      { arm: 'y', runs: 1, passed: 1, failed: 0, passRate: 1, medianSeconds: 2 },
    ]);
  });

  it('hides arm names, keeps a key, and drops groups with fewer than two passing replies', () => {
    const { sheet, key } = blindSheet([row('x', true, 1, 'AAA'), row('y', true, 1, 'BBB'), row('z', false, 1, null)]);
    expect(sheet).toContain('AAA');
    expect(sheet).toContain('BBB');
    expect(sheet).not.toMatch(/\bx\b|\by\b|\bz\b/);
    expect(Object.values(key['a#0|structure']!).sort()).toEqual(['x', 'y']);
    expect(blindSheet([row('x', true, 1), row('z', false, 1, null)]).sheet).toBe('');
  });
});
