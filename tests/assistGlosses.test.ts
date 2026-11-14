import { describe, expect, it } from 'vitest';

import { buildGlossPrompt, parseGlosses } from '../src/lib/assistGlosses';

const words = [{ expression: '種類', reading: 'しゅるい' }, { expression: 'ある' }];

describe('assist glosses', () => {
  it('puts the sentence and each requested word in the prompt', () => {
    const prompt = buildGlossPrompt('種類がある。', words);
    expect(prompt).toContain('SENTENCE: 種類がある。');
    expect(prompt).toContain('- 種類 (reading しゅるい)');
    expect(prompt).toContain('- ある');
  });

  it('keeps only requested expressions with a meaning, deduped and trimmed', () => {
    const reply =
      'Sure:\n[{"expression":"種類","meaning":" type; kind "},{"expression":"種類","meaning":"dup"},{"expression":"他","meaning":"unasked"},{"expression":"ある","meaning":""},7]';
    expect(parseGlosses(reply, words)).toEqual([{ expression: '種類', meaning: 'type; kind' }]);
  });

  it('treats malformed replies as no glosses', () => {
    expect(parseGlosses('no json', words)).toEqual([]);
    expect(parseGlosses('[{oops', words)).toEqual([]);
  });
});
