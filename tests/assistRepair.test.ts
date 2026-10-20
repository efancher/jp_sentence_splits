import { describe, expect, it } from 'vitest';

import { findBadHandles, mergeRepair } from '../src/lib/assistRepair';
import { planExtraTasks, runExtraTasks, type ExtrasSentence } from '../src/lib/assistExtras';

const sentences: ExtrasSentence[] = [
  { handle: 1, japanese: '私は学生です。', translation: 'I am a student.' },
  { handle: 2, japanese: '本を読みます。', translation: 'I read a book.' },
  { handle: 3, japanese: '猫が好きです。', translation: 'I like cats.' },
];

const GOOD_1 = ['S1 | 私は | topic は | as for me', 'S1 | 学生です。 | predicate | am a student'];
const GOOD_2 = ['S2 | 本を | object を | the book', 'S2 | 読みます。 | predicate | read'];
const GOOD_3 = ['S3 | 猫が | subject が | cat', 'S3 | 好きです。 | predicate | like'];
const BAD_2 = ['S2 | 本を | object を | the book', 'S2 | 読み | predicate | read']; // does not rebuild the sentence

describe('findBadHandles', () => {
  it('flags only structure sentences whose chunks do not rebuild the text', () => {
    const task = { kind: 'structure' as const, from: 1, to: 3 };
    const reply = [...GOOD_1, ...BAD_2, ...GOOD_3].join('\n');
    expect(findBadHandles(task, reply, sentences).map((bad) => bad.handle)).toEqual([2]);
  });

  it('flags sentences missing from a particles reply', () => {
    const task = { kind: 'particles' as const, from: 1, to: 2 };
    const reply = '=== Sentence 1 ===\nNONE';
    expect(findBadHandles(task, reply, sentences).map((bad) => bad.handle)).toEqual([2]);
  });
});

describe('mergeRepair', () => {
  it('replaces only the repaired structure sentence and leaves the others untouched', () => {
    const merged = mergeRepair('structure', [...GOOD_1, ...BAD_2, ...GOOD_3].join('\n'), [...GOOD_2, ...GOOD_1].join('\n'), new Set([2]));
    expect(merged.split('\n')).toEqual([...GOOD_1, ...GOOD_3, ...GOOD_2]);
  });

  it('merges walkthrough JSON by sentence handle', () => {
    const original = JSON.stringify({ walkthroughs: { S1: { natural: 'a' }, S2: { natural: 'old' } } });
    const repair = JSON.stringify({ walkthroughs: { S2: { natural: 'new' }, S1: { natural: 'ignored' } } });
    const merged = JSON.parse(mergeRepair('walkthroughs', original, repair, new Set([2])));
    expect(merged.walkthroughs).toEqual({ S1: { natural: 'a' }, S2: { natural: 'new' } });
  });
});

describe('runExtraTasks', () => {
  const base = () => ({
    sentences,
    replies: {},
    onTaskDone: () => {},
    onProgress: () => {},
    isCancelled: () => false,
  });

  it('re-asks only for the bad sentence and keeps the good ones', async () => {
    const prompts: string[] = [];
    const done: Record<string, string> = {};
    const result = await runExtraTasks({
      ...base(),
      tasks: planExtraTasks(sentences, { structure: true }),
      run: async (prompt) => {
        prompts.push(prompt);
        return { reply: prompts.length === 1 ? [...GOOD_1, ...BAD_2, ...GOOD_3].join('\n') : GOOD_2.join('\n'), backend: 'x' };
      },
      onTaskDone: (id, text) => {
        done[id] = text;
      },
    });
    expect(result.failures).toEqual([]);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('these 1 sentences: S2.');
    expect(prompts[1]).toContain('Fix these problems');
    expect(Object.values(done)[0]!.split('\n').sort()).toEqual([...GOOD_1, ...GOOD_2, ...GOOD_3].sort());
  });

  it('carries on past a failed piece instead of stopping the run', async () => {
    let calls = 0;
    const result = await runExtraTasks({
      ...base(),
      tasks: planExtraTasks(sentences, { structure: true, particles: true }),
      run: async () => {
        calls += 1;
        if (calls <= 2) throw new Error('boom');
        return { reply: ['=== Sentence 1 ===', 'NONE', '=== Sentence 2 ===', 'NONE', '=== Sentence 3 ===', 'NONE'].join('\n'), backend: 'x' };
      },
    });
    expect(result.failures).toHaveLength(1);
    expect(result.failure?.task.kind).toBe('structure');
    expect(Object.keys(result.replies)).toEqual(['particles:1-3']);
  });
});
