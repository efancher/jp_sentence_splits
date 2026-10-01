import { describe, expect, it } from 'vitest';

import { buildEpisodePackPrompts, parseEpisodePackReply, planEpisodePack } from '../src/lib/episodePack';
import type { PreparationContext } from '../src/lib/episodePreparation';
import { buildStructureInstructions, STRUCTURE_LINE_EXAMPLE, parseStructure } from '../src/lib/episodeStructure';
import { walkthroughChunks } from '../src/components/SentenceWalkthrough';

const context: PreparationContext = {
  title: 'Episode 1',
  sentences: [
    { id: 's-a', japanese: '本を読みます。', translation: 'I read.' },
    { id: 's-b', japanese: '本を買いました。', translation: 'I bought.' },
  ],
  vocabulary: [],
  grammar: [],
};
const good = [
  { text: '本を', role: 'object', gloss: 'book (object)' },
  { text: '読みます。', role: 'engine', gloss: 'read' },
];

describe('episode structure', () => {
  it('accepts chunks that rebuild the sentence and rejects the rest', () => {
    const { drafts, rejected } = parseStructure(
      { S1: good, S2: [{ text: '別の', role: 'engine' }], S9: good },
      context,
    );
    expect([...drafts.keys()]).toEqual(['s-a']);
    expect(drafts.get('s-a')![0]).toEqual({ japanese: '本を', role: 'object', literalEnglish: 'book (object)' });
    expect(rejected.map((item) => item.handle).sort()).toEqual(['S2', 'S9']);
  });

  it('is asked only when opted in, in its own prompt', () => {
    // (prompt asks for lines, not JSON)
    const none = planEpisodePack(context, undefined, {});
    expect(buildEpisodePackPrompts(context, planEpisodePack(context, { targets: [{}] } as never, {})).length).toBeLessThanOrEqual(1);
    expect(none.structureHandles).toEqual([]);
    const plan = planEpisodePack(context, { targets: [{}] } as never, { structureSentenceIds: new Set(['s-b']) });
    const prompts = buildEpisodePackPrompts(context, plan);
    expect(prompts.at(-1)).toContain('S2: 本を買いました。');
    expect(prompts.at(-1)).not.toContain('S1:');
  });

  it('a structure-only reply parses', () => {
    const parsed = parseEpisodePackReply(JSON.stringify({ structure: { S1: good } }), context, '2026-09-30T00:00:00.000Z');
    expect(parsed.error).toBeUndefined();
    expect(parsed.structure?.drafts.size).toBe(1);
  });

  it('walkthrough ranks saved analysis over AI draft over automatic draft', () => {
    const sentence = { id: 's-a', japanese: '本を読みます。' };
    const draft = [{ japanese: '本を', role: 'object' }, { japanese: '読みます。', role: 'engine' }];
    expect(walkthroughChunks(sentence, undefined, draft).source).toBe('ai_draft');
    expect(walkthroughChunks(sentence, undefined, [{ japanese: '違う', role: 'x' }]).source).toBe('draft');
  });
});

import { extractJson } from '../src/lib/episodePreparation';

describe('extractJson with curly quotes', () => {
  it('repairs curly delimiters that also contain curly quotation marks inside a value', () => {
    const reply = '{“structure”: {“S1”: [{“text”: “本を”, “role”: “object”, “gloss”: “the “book” (object)”}]}}';
    const parsed = extractJson(reply) as { structure: { S1: { gloss: string }[] } };
    expect(parsed.structure.S1[0]!.gloss).toBe("the 'book' (object)");
  });
});

describe('extractJson with curly delimiters and straight quotes inside a value', () => {
  it('keeps a straight-quoted phrase inside a curly-delimited gloss', () => {
    const reply = '{\n“structure”: {\n“S1”: [\n{\n“text”: “本を”,\n“role”: “object”,\n“gloss”: “"that’s a bit…"”\n}\n]\n}\n}';
    const parsed = extractJson(reply) as { structure: { S1: { gloss: string }[] } };
    expect(parsed.structure.S1[0]!.gloss).toBe("'that’s a bit…'");
  });
});

describe('line-based structure replies', () => {
  it('tolerates chatter, fences, quotes, table pipes, and a cut-off last sentence', () => {
    const reply = [
      'Sure! Here you go:',
      '```',
      '| S1 | 本を | object | book (“the” book) |',
      '|---|---|---|---|',
      '- S1: | 読みます。 | engine | read',
      'S2 | 本を | object | "book"',
      'S2 | 買い',
      '```',
    ].join('\n');
    const parsed = parseEpisodePackReply(reply, context, '2026-09-30T00:00:00.000Z');
    expect(parsed.error).toBeUndefined();
    expect([...parsed.structure!.drafts.keys()]).toEqual(['s-a']);
    expect(parsed.structure!.drafts.get('s-a')!.map((chunk) => chunk.japanese)).toEqual(['本を', '読みます。']);
    expect(parsed.structure!.rejected.map((item) => item.handle)).toEqual(['S2']);
  });

  it('asks for lines, not JSON', () => {
    const plan = planEpisodePack(context, { targets: [{}] } as never, { structureSentenceIds: new Set(['s-b']) });
    const prompt = buildEpisodePackPrompts(context, plan).at(-1)!;
    expect(prompt).toContain('handle | chunk text | role | short English gloss');
    expect(prompt).not.toContain('"structure"');
  });
});

describe('structure prompt glosses', () => {
  it('asks for literal glosses on every chunk, including non-vocabulary expressions', () => {
    const text = buildStructureInstructions().join('\n');
    expect(text).toContain('dolly');
    expect(text).toContain('EVERY chunk');
    expect(STRUCTURE_LINE_EXAMPLE).toContain('もう一つは | topic は | another one, as for');
  });
});
