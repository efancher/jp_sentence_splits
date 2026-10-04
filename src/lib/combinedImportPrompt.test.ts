import { describe, expect, it } from 'vitest';

import {
  COMBINED_REPLY_FILENAME,
  formatCombinedPromptForAI,
  remapSentenceHandles,
  splitCombinedReply,
} from './combinedImportPrompt';
import { parseAiCombinedReply } from './miningQuickImport';

const segs = [{ text: 'こんにちは', startMs: 0, endMs: 2000, isAuto: true, lowConfidence: false }];

describe('formatCombinedPromptForAI', () => {
  it('asks for every part and a downloadable file by default', () => {
    const prompt = formatCombinedPromptForAI(segs);
    for (const heading of ['SENTENCES', 'EPISODE PACK', 'STRUCTURE', 'COMPREHENSION', 'PARTICLES']) {
      expect(prompt).toContain(`=== ${heading} ===`);
    }
    expect(prompt).toContain(COMBINED_REPLY_FILENAME);
    expect(prompt).toContain('[0:00] こんにちは');
  });

  it('omits unrequested parts', () => {
    const prompt = formatCombinedPromptForAI(segs, {
      targets: false,
      constructions: false,
      structure: false,
      comprehension: false,
      particles: false,
    });
    expect(prompt).toContain('=== SENTENCES ===');
    expect(prompt).not.toContain('=== EPISODE PACK ===');
    expect(prompt).not.toContain('=== PARTICLES ===');
  });
});

describe('splitCombinedReply', () => {
  it('splits headed parts and ignores code fences', () => {
    const reply = [
      '```',
      '=== SENTENCES ===',
      '[0:00] こんにちは。 || Hello.',
      '=== STRUCTURE ===',
      'S1 | こんにちは。 | expression | hello',
      '=== COMPREHENSION ===',
      '=== Sentence 1 ===',
      '1. a',
      '```',
    ].join('\n');
    const sections = splitCombinedReply(reply);
    expect(sections.sentences).toBe('[0:00] こんにちは。 || Hello.');
    expect(sections.structure).toContain('S1 |');
    expect(sections.comprehension).toContain('=== Sentence 1 ===');
    expect(parseAiCombinedReply(sections.sentences, 2000)).toHaveLength(1);
  });

  it('treats a headerless reply as plain sentence lines', () => {
    const reply = '[0:00] こんにちは。 || Hello.';
    expect(splitCombinedReply(reply).sentences).toBe(reply);
  });
});

describe('remapSentenceHandles', () => {
  it('rewrites mapped handles and zeroes unmapped ones', () => {
    const map = new Map([[1, 3]]);
    expect(remapSentenceHandles('S1 | a\nS2 | b\n"sentence": "S1"', map)).toBe('S3 | a\nS0 | b\n"sentence": "S3"');
  });
});
