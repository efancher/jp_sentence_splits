import { describe, expect, it, vi } from 'vitest';

import {
  buildExtraPrompt,
  mergeExtraReplies,
  planExtraTasks,
  runExtraTasks,
  validateExtraReply,
  type ExtrasSentence,
} from './assistExtras';
import { MAX_ATTEMPTS_PER_CHUNK } from './assistChunks';

const sentences: ExtrasSentence[] = Array.from({ length: 6 }, (_, i) => ({
  handle: i + 1,
  japanese: `文${i + 1}。`,
  translation: `Sentence ${i + 1}.`,
}));
const only = (kind: string) => ({ [kind]: true });

describe('planExtraTasks', () => {
  it('splits per-sentence extras into ranges and keeps targets as one whole-episode task', () => {
    const tasks = planExtraTasks(sentences, { structure: true, targets: true }, 4);
    expect(tasks.map((t) => t.id)).toEqual(['structure:1-4', 'structure:5-6', 'targets:1-6']);
  });

  it('shows context sentences around a range but marks them', () => {
    const tasks = planExtraTasks(sentences, only('structure'), 3);
    const prompt = buildExtraPrompt(tasks[1]!, sentences);
    expect(prompt).toContain('(context) S3 ');
    expect(prompt).toContain('\nS4 文4。 || Sentence 4.');
    expect(prompt).toContain('Work on ONLY S4 to S6');
    expect(prompt).not.toContain('PART 1');
    expect(prompt).not.toContain('STRUCTURE THESE');
  });
});

describe('validateExtraReply', () => {
  const [structure] = planExtraTasks(sentences, only('structure'));
  const [walk] = planExtraTasks(sentences, only('walkthroughs'));
  const [comp] = planExtraTasks(sentences, only('comprehension'));

  it('flags structure output that stops before the last sentence', () => {
    expect(validateExtraReply(structure!, 'S1 | 文 | topic | x\nS5 | 文 | verb | y')).toMatch(/S6/);
    expect(validateExtraReply(structure!, 'S1 | 文 | topic | x\nS6 | 文 | verb | y')).toBeNull();
  });

  it('flags cut-off or non-JSON walkthroughs', () => {
    expect(validateExtraReply(walk!, '{"walkthroughs": {"S1": {}}}')).toMatch(/S6/);
    expect(validateExtraReply(walk!, '{"walkthroughs": {"S1": {}, "S6": {}}}')).toBeNull();
    expect(validateExtraReply(walk!, 'sorry')).toMatch(/walkthroughs/);
  });

  it('wants the last sentence header for comprehension', () => {
    expect(validateExtraReply(comp!, '=== Sentence 1 ===\n1. a')).toMatch(/Sentence 6/);
    expect(validateExtraReply(comp!, '=== Sentence 6 ===\n*1. a')).toBeNull();
  });
});

describe('mergeExtraReplies', () => {
  it('merges JSON pieces into one pack and concatenates the text kinds', () => {
    const tasks = planExtraTasks(sentences, { walkthroughs: true, structure: true, targets: true }, 3);
    const replies: Record<string, string> = {
      'walkthroughs:1-3': '{"walkthroughs": {"S1": {"a": 1}}}',
      'walkthroughs:4-6': '```json\n{"walkthroughs": {"S4": {"b": 2}}}\n```',
      'structure:1-3': 'S1 | a | b | c',
      'structure:4-6': 'S4 | a | b | c',
      'targets:1-6': '{"targets": [{"label": "x"}]}',
    };
    const merged = mergeExtraReplies(tasks, replies);
    expect(JSON.parse(merged.pack)).toEqual({
      version: 1,
      targets: [{ label: 'x' }],
      walkthroughs: { S1: { a: 1 }, S4: { b: 2 } },
    });
    expect(merged.structure).toBe('S1 | a | b | c\nS4 | a | b | c');
    expect(merged.comprehension).toBe('');
  });
});

describe('runExtraTasks', () => {
  const base = { sentences, replies: {}, onTaskDone: () => {}, onProgress: () => {}, isCancelled: () => false };

  it('stops after the capped attempts and keeps finished pieces for a resume', async () => {
    const tasks = planExtraTasks(sentences, only('structure'), 3);
    const run = vi
      .fn()
      .mockResolvedValueOnce({ reply: 'S3 | a | b | c', backend: 'codex' })
      .mockRejectedValue(new Error('rate limited'));
    const first = await runExtraTasks({ ...base, tasks, run });
    expect(run).toHaveBeenCalledTimes(1 + MAX_ATTEMPTS_PER_CHUNK);
    expect(first.failure?.task.id).toBe('structure:4-6');
    expect(Object.keys(first.replies)).toEqual(['structure:1-3']);

    const run2 = vi.fn().mockResolvedValue({ reply: 'S6 | a | b | c', backend: 'claude' });
    const second = await runExtraTasks({ ...base, tasks, replies: first.replies, run: run2 });
    expect(run2).toHaveBeenCalledTimes(1);
    expect(second.failure).toBeNull();
  });
});
