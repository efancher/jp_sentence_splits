import { describe, expect, it } from 'vitest';

import { formatBatchMeaningBankPromptForAI, parseBatchMeaningBankReply } from './meaningChoices';
import {
  applyReadingFixes,
  inlineKana,
  judgeSpan,
  llmSpanReadings,
  sameReading,
} from './readingConsensus';

const INLINE = 'この前[ぜん]、駅[えき]に行[い]った。';

describe('readingConsensus', () => {
  it('treats vowel-length spellings as the same reading', () => {
    expect(sameReading('おもう', 'おもー')).toBe(true);
    expect(sameReading('まえ', 'ぜん')).toBe(false);
  });

  it('builds the tokenizer kana string with span offsets', () => {
    const { kana, spans } = inlineKana(INLINE);
    expect(kana).toBe('このぜん、えきにいった。');
    expect(spans).toHaveLength(3);
  });

  it('reads each span off the LLM whole-sentence reading', () => {
    const spans = llmSpanReadings(INLINE, 'このまえ、えきにいった。');
    expect([...spans.values()]).toEqual(['まえ', 'えき', 'い']);
  });

  it('ignores whitespace and katakana in the LLM reply', () => {
    const spans = llmSpanReadings(INLINE, 'この マエ、 えき に いった。');
    expect([...spans.values()]).toEqual(['まえ', 'えき', 'い']);
  });

  it('judges: fix only when audio and LLM agree against the tokenizer', () => {
    expect(judgeSpan('ぜん', 'まえ', 'まえ')).toEqual({ kind: 'fix', reading: 'まえ' });
    expect(judgeSpan('ぜん', 'まえ', undefined)).toEqual({ kind: 'flag', audio: 'まえ', llm: undefined });
    expect(judgeSpan('ぜん', 'まえ', 'ぜん')).toMatchObject({ kind: 'flag', audio: 'まえ' });
    expect(judgeSpan('ぜん', 'まえ', 'さき')).toMatchObject({ kind: 'flag', audio: 'まえ', llm: 'さき' });
    expect(judgeSpan('まえ', 'まえ', 'まえ')).toEqual({ kind: 'agree' });
    expect(judgeSpan('まえ')).toEqual({ kind: 'unchecked' });
  });

  it('rewrites only the fixed spans and refuses markup that does not round-trip', () => {
    const fixed = applyReadingFixes(INLINE, new Map([[1, 'まえ']]));
    expect(fixed).toBe('この前[まえ]、駅[えき]に行[い]った。');
    expect(applyReadingFixes('[音楽]が流れる。', new Map([[0, 'x']]))).toBe('[音楽]が流れる。');
  });
});

describe('batch meaning-bank prompt reading line', () => {
  it('asks for a READING line and parses it back', () => {
    const prompt = formatBatchMeaningBankPromptForAI([{ japanese: 'この前、駅に行った。', context: [] }]);
    expect(prompt).toContain('READING:');
    const [parsed] = parseBatchMeaningBankReply(
      '=== Sentence 1 ===\nREADING: このまえ、えきにいった。\n- a\n- b\n- c',
      1,
    );
    expect(parsed?.reading).toBe('このまえ、えきにいった。');
    expect(parsed?.wrong).toEqual(['a', 'b', 'c']);
  });
});
