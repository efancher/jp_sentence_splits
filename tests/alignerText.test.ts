import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DAY_READINGS, MONTH_READINGS, alignerView } from '../src/lib/alignerText';

describe('alignerView', () => {
  it('drops punctuation and whitespace, keeping each kept character’s raw range', () => {
    const view = alignerView('はい、 本。');
    expect(view.chars).toEqual(['は', 'い', '本']);
    expect(view.rawStart).toEqual([0, 1, 4]);
    expect(view.rawEnd).toEqual([1, 2, 5]);
  });

  it('expands a digit+日/月 date to its reading, every character mapping to the whole raw date', () => {
    const view = alignerView('16日は雨');
    expect(view.chars.join('')).toBe('じゅうろくにちは雨');
    // じゅうろくにち → all from raw [0,3) = "16日"
    expect(view.rawStart.slice(0, 7)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(view.rawEnd.slice(0, 7)).toEqual([3, 3, 3, 3, 3, 3, 3]);
    expect(view.rawStart[7]).toBe(3); // は
  });

  it('handles fullwidth digits and months, and leaves out-of-range numbers and other counters alone', () => {
    expect(alignerView('１０月に').chars.join('')).toBe('じゅうがつに');
    expect(alignerView('40日').chars.join('')).toBe('40日');
    expect(alignerView('100匹').chars.join('')).toBe('100匹');
    expect(alignerView('今日は月曜日').chars.join('')).toBe('今日は月曜日');
  });
});

// The tables are duplicated from the aligner service (a separate repo). When it
// is checked out next to this one, prove they haven't drifted.
const ALIGNER_NUMERALS = join(homedir(), 'projects/shadowing-analysis-api/app/numerals.py');

describe('numeral tables vs the aligner service', () => {
  it.skipIf(!existsSync(ALIGNER_NUMERALS))('match app/numerals.py exactly', () => {
    const source = readFileSync(ALIGNER_NUMERALS, 'utf8');
    const parse = (name: string) => {
      const block = new RegExp(`${name}: dict\\[int, str\\] = \\{([\\s\\S]*?)\\n\\}`).exec(source)![1]!;
      return Object.fromEntries([...block.matchAll(/(\d+): "([^"]+)"/g)].map((m) => [Number(m[1]), m[2]]));
    };
    expect(DAY_READINGS).toEqual(parse('_DAY_READINGS'));
    expect(MONTH_READINGS).toEqual(parse('_MONTH_READINGS'));
  });
});
