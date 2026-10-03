import { describe, expect, it } from 'vitest';

import { previewHeuristicChunks } from '../src/lib/analysisHelpers';
import { buildDecisions, gradeResponse, matchParticleCheck, type GlossChunk } from '../src/lib/glossSkill';
import { formatBookParticlePromptForAI, parseBookChunkIssues, parseBookParticleReply } from '../src/lib/particleChecks';

const BLOCK = [
  'CHUNK: ゴミ箱に',
  'Q: What is the bin to the action of putting?',
  '1. the bin is where it happens',
  '*2. the bin is where the thing ends up',
  '3. the bin is who receives it',
  '4. the bin is what it is compared to',
];

describe('parseBookParticleReply', () => {
  it('parses blocks per sentence, NONE as [], and missing sections as null', () => {
    const reply = ['=== Sentence 1 ===', ...BLOCK, '', '=== Sentence 2 ===', 'NONE'].join('\n');
    const parsed = parseBookParticleReply(reply, 3);
    expect(parsed[0]).toEqual([
      {
        chunk: 'ゴミ箱に',
        particle: 'に',
        question: 'What is the bin to the action of putting?',
        options: [
          'the bin is where it happens',
          'the bin is where the thing ends up',
          'the bin is who receives it',
          'the bin is what it is compared to',
        ],
        correctIndex: 1,
      },
    ]);
    expect(parsed[1]).toEqual([]);
    expect(parsed[2]).toBeNull();
  });

  it('leaves a section pending when its only block is malformed', () => {
    const bad = ['=== Sentence 1 ===', 'CHUNK: ゴミ箱に', 'Q: x', '1. a', '2. b'].join('\n');
    expect(parseBookParticleReply(bad, 1)).toEqual([null]);
  });

  it('rejects blocks with zero or multiple correct marks', () => {
    const none = ['=== Sentence 1 ===', ...BLOCK.map((line) => line.replace('*', ''))].join('\n');
    expect(parseBookParticleReply(none, 1)).toEqual([null]);
  });
});

describe('parseBookChunkIssues', () => {
  it('collects ISSUE lines per sentence, including under NONE and alongside blocks', () => {
    const reply = [
      '=== Sentence 1 ===',
      'ISSUE: ありが | とう → ありがとう',
      'NONE',
      '=== Sentence 2 ===',
      ...BLOCK,
      'ISSUE: と | き → とき',
      'ISSUE: も | ちろん → もちろん',
      '=== Sentence 3 ===',
      'NONE',
    ].join('\n');
    expect(parseBookChunkIssues(reply, 3)).toEqual([
      ['ありが | とう → ありがとう'],
      ['と | き → とき', 'も | ちろん → もちろん'],
      [],
    ]);
    expect(parseBookParticleReply(reply, 3)[1]).toHaveLength(1);
  });
});

describe('prompt', () => {
  it('numbers sentences and includes context and translation', () => {
    const prompt = formatBookParticlePromptForAI([
      { japanese: 'ゴミ箱に入れた。', context: ['前の文。'], translation: 'I put it in the bin.', chunks: ['ゴミ箱に', '入れた。'] },
    ]);
    expect(prompt).toContain('ゴミ箱に | 入れた。');
    expect(prompt).toContain('=== Sentence 1 ===');
    expect(prompt).toContain('前の文。');
    expect(prompt).toContain('I put it in the bin.');
  });
});

describe('wider particle coverage', () => {
  it('parses multi-character and topic/object particles', () => {
    const reply = ['=== Sentence 1 ===', ...BLOCK.map((l) => l.replace('ゴミ箱に', '駅から'))].join('\n');
    expect(parseBookParticleReply(reply, 1)[0]?.[0]?.particle).toBe('から');
    const reply2 = ['=== Sentence 1 ===', ...BLOCK.map((l) => l.replace('ゴミ箱に', '本を'))].join('\n');
    expect(parseBookParticleReply(reply2, 1)[0]?.[0]?.particle).toBe('を');
  });

  it('turns an authored を check into a contextual decision', () => {
    const preview = previewHeuristicChunks('ケーキを食べた。');
    const chunks: GlossChunk[] = preview.parts.map((part, index) => ({ id: `c${index}`, japanese: part, role: preview.roles[index] ?? '' }));
    const check = { chunk: 'ケーキを', particle: 'を', question: 'What is the cake to the eating?', options: ['what gets eaten', 'who eats', 'where', 'when'], correctIndex: 0 };
    const spec = buildDecisions(chunks, [check]).find((s) => s.particle === 'を');
    expect(spec?.question).toBe(check.question);
    expect(spec?.ruleKey).toBe('particle:を:ctx');
  });
});

describe('contextual particle decisions', () => {
  const check = {
    chunk: 'ゴミ箱に',
    particle: 'に',
    question: 'What is the bin to the action of putting?',
    options: ['where it happens', 'where the thing ends up', 'who receives it', 'what it is compared to'],
    correctIndex: 1,
  };
  const preview = previewHeuristicChunks('ゴミ箱に入れた。');
  const chunks: GlossChunk[] = preview.parts.map((part, index) => ({ id: `c${index}`, japanese: part, role: preview.roles[index] ?? '' }));

  it('matches tolerant of chunk boundary differences', () => {
    expect(matchParticleCheck([check], 'ゴミ箱に', 'に')).toBe(check);
    expect(matchParticleCheck([check], 'その大きなゴミ箱に', 'に')).toBe(check);
    expect(matchParticleCheck([check], 'ゴミ箱で', 'で')).toBeUndefined();
  });

  it('replaces the generic relation list with a graded, sentence-specific question', () => {
    const spec = buildDecisions(chunks, [check]).find((s) => s.particle === 'に');
    expect(spec?.question).toBe(check.question);
    expect(spec?.confidence).toBe('settled');
    expect(spec?.options.map((o) => o.label).sort()).toEqual([...check.options].sort());
    expect(gradeResponse(spec!, spec!.referenceValue)).toBe(true);
    expect(spec!.options.find((o) => o.id === spec!.referenceValue)?.label).toBe('where the thing ends up');
  });

  it('keeps the generic ungraded に check when nothing is authored', () => {
    const spec = buildDecisions(chunks).find((s) => s.particle === 'に');
    expect(spec?.question).toBeUndefined();
    expect(spec?.confidence).toBe('alternative');
  });
});
