import { describe, expect, it } from 'vitest';

import { buildEpisodePackPrompts, parseEpisodePackReply, planEpisodePack } from '../src/lib/episodePack';
import type { PreparationContext } from '../src/lib/episodePreparation';
import { buildStructureInstructions, STRUCTURE_LINE_EXAMPLE, parseStructure, parseStructureLines } from '../src/lib/episodeStructure';
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

  it('is asked only when opted in, and rides in the same single prompt as targets/translations', () => {
    const none = planEpisodePack(context, undefined, {});
    expect(none.structureHandles).toEqual([]);
    const plan = planEpisodePack(context, undefined, { structureSentenceIds: new Set(['s-b']) });
    const prompts = buildEpisodePackPrompts(context, plan);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('FOCUS TARGETS');
    expect(prompts[0]).toContain('STRUCTURE THESE:\nS2: 本を買いました。');
    expect(prompts[0]!.split('STRUCTURE THESE:\n')[1]!.split('\n\n')[0]).toBe('S2: 本を買いました。');
    expect(prompts[0]).toContain('Reply in two parts');
  });

  it('keeps a structure-only prompt when nothing else is needed', () => {
    const plan = planEpisodePack(context, undefined, { structureSentenceIds: new Set(['s-b']), forceTargets: false });
    const prompts = buildEpisodePackPrompts(context, { ...plan, wantsTargets: false, missingTranslationHandles: [] });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain('FOCUS TARGETS');
  });

  it('parses JSON plus trailing structure lines from one reply', () => {
    const reply = [
      '```json',
      JSON.stringify({ version: 1, translations: { S1: 'I read.' } }),
      '```',
      'S1 | 本を | object | book (object)',
      'S1 | 読みます。 | engine: verb | read',
    ].join('\n');
    const parsed = parseEpisodePackReply(reply, context, '2026-09-30T00:00:00.000Z');
    expect(parsed.error).toBeUndefined();
    expect(parsed.structure?.drafts.get('s-a')).toHaveLength(2);
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

describe('structure lines with 「」 in the sentence', () => {
  const quoted: PreparationContext = {
    ...context,
    sentences: [{ id: 's-q', japanese: '私の今年の抱負は「健康に気をつける」です。', translation: 'x' }],
  };
  const reply = ['S1 | 私の | の-car | my', 'S1 | 今年の | の-car | this year', 'S1 | 抱負は | topic は | resolution', 'S1 | 「健康に | に-car | to health', 'S1 | 気をつける」 | engine: verb | pay attention', 'S1 | です。 | engine: copula | is'].join('\n');

  it('keeps the brackets so the chunks rebuild the sentence', () => {
    const { drafts, rejected } = parseStructureLines(reply, quoted);
    expect(rejected).toEqual([]);
    expect(drafts.get('s-q')?.map((c) => c.japanese).join('')).toBe('私の今年の抱負は「健康に気をつける」です。');
  });

  it('still accepts a chunk the assistant wrapped in 「」 that the sentence lacks', () => {
    const plain: PreparationContext = { ...context, sentences: [{ id: 's-p', japanese: '健康に気をつける', translation: 'x' }] };
    const { drafts } = parseStructureLines(['S1 | 「健康に」 | に-car | a', 'S1 | 気をつける | engine | b'].join('\n'), plain);
    expect(drafts.get('s-p')).toHaveLength(2);
  });
});

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


describe('fixed-expression import guard', () => {
  const ctx: PreparationContext = { title: 'pilot', sentences: [{ id: 's', japanese: '「でもね」と言いました。' }], vocabulary: [], grammar: [] };
  it('rejects a text-preserving but misleading split in both reply formats', () => {
    const chunks = [{ text: '「でも', role: 'でも-car' }, { text: 'ね」と', role: 'と-car' }, { text: '言いました。', role: 'engine' }];
    const json = parseStructure({ S1: chunks }, ctx);
    const lines = parseStructureLines(chunks.map((c) => `S1 | ${c.text} | ${c.role}`).join('\n'), ctx);
    for (const parsed of [json, lines]) {
      expect(parsed.drafts.size).toBe(0);
      expect(parsed.rejected[0]?.reason).toContain('でもね');
    }
  });
});
