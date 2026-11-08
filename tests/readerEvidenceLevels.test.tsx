import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { KaraokeSentenceText } from '../src/components/KaraokeSentenceText';
import { resetDbForTests } from '../src/db/database';
import { getDb, getReaderEvidenceLevels, resetWordStrengthCache } from '../src/db/repository';
import type { VocabularySuggestion } from '../src/domain/types';
import { grammarFeedbackTargetKey } from '../src/lib/grammarEvidence';
import { createId } from '../src/lib/ids';
import { evidenceLevel } from '../src/lib/wordStrength';

describe('evidenceLevel', () => {
  it('is unchecked with no strength, shaky below the known line and solid at it', () => {
    expect(evidenceLevel(undefined)).toBe('unchecked');
    expect(evidenceLevel(0.3)).toBe('shaky');
    expect(evidenceLevel(0.6)).toBe('solid');
  });
});

describe('getReaderEvidenceLevels', () => {
  beforeEach(() => {
    resetDbForTests(`reader-evidence-${createId('db')}`);
    resetWordStrengthCache();
  });

  async function tap(patternId: string, outcome: 'got_it' | 'needed_help') {
    await getDb().sentenceLearningEvents.put({
      id: createId('sle'), sentenceId: 's1', bookId: 'b1', action: 'target_practice', timestamp: new Date().toISOString(),
      target: { kind: 'grammar', key: grammarFeedbackTargetKey(patternId, 'use'), label: patternId },
      support: 'target_masked', outcome,
    } as never);
  }

  it('marks patterns never tapped unchecked, missed ones shaky and repeatedly recalled ones solid', async () => {
    for (let i = 0; i < 3; i += 1) await tap('p-solid', 'got_it');
    await tap('p-shaky', 'needed_help');
    const levels = await getReaderEvidenceLevels([], ['p-none', 'p-shaky', 'p-solid']);
    expect(levels.get('pattern:p-none')).toBe('unchecked');
    expect(levels.get('pattern:p-shaky')).toBe('shaky');
    expect(levels.get('pattern:p-solid')).toBe('solid');
  });

  it('marks a word with no events unchecked', async () => {
    const levels = await getReaderEvidenceLevels(['no-such-word'], []);
    expect(levels.get('word:no-such-word')).toBe('unchecked');
  });
});

describe('KaraokeSentenceText evidence styling', () => {
  const suggestion = (surface: string, start: number): VocabularySuggestion => ({
    id: `s-${start}`, surface, start, end: start + surface.length, expression: surface, reading: '', pos: '名詞',
    source: 'morphology', selectedByDefault: true,
  });

  it('flags unchecked and shaky tappable words and leaves solid ones plain', () => {
    const { container } = render(
      <KaraokeSentenceText
        japanese="空と海と山"
        vocabularySuggestions={[suggestion('空', 0), suggestion('海', 2), suggestion('山', 4)]}
        isWordTappable={(token) => ['空', '海', '山'].includes(token.text)}
        onWordTap={() => undefined}
        evidenceOf={(token) => ({ 空: 'unchecked', 海: 'shaky', 山: 'solid' } as const)[token.text as '空' | '海' | '山']}
      />,
    );
    expect(container.querySelectorAll('.karaoke-evidence-unchecked')).toHaveLength(1);
    expect(container.querySelector('.karaoke-evidence-unchecked')).toHaveTextContent('空');
    expect(container.querySelector('.karaoke-evidence-shaky')).toHaveTextContent('海');
    expect(container.querySelectorAll('.karaoke-word-checkable')).toHaveLength(3);
  });
});
