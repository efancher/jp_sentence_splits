import { describe, expect, it } from 'vitest';

import { applyReadingFlagFix, parseReadingFlagNote, readingFlagIsApplied } from './readingFlagFix';

describe('readingFlagFix', () => {
  it('parses a flag note, with and without audio', () => {
    expect(parseReadingFlagNote('Reading check — 頃: furigana ころ, assistant ごろ')).toEqual({
      base: '頃',
      furigana: 'ころ',
      assistant: 'ごろ',
      hasAudio: false,
    });
    expect(parseReadingFlagNote('Reading check — 頃: furigana ころ, audio ころ, assistant ごろ')?.hasAudio).toBe(true);
    expect(parseReadingFlagNote('Reading check — readings differ but the furigana markup')).toBeNull();
  });

  it('rewrites a sound-change flag and the matching reading_only', () => {
    const inline = 'そして4月[しがつ]頃[ころ]からポプラが飛び[とび]始め[はじめ]、';
    const fix = applyReadingFlagFix(
      { inlineReading: inline, readingOnly: 'そしてしがつころからポプラがとびはじめ、' },
      { base: '頃', furigana: 'ころ', assistant: 'ごろ', hasAudio: false },
    );
    expect(fix?.inlineReading).toBe('そして4月[しがつ]頃[ごろ]からポプラが飛び[とび]始め[はじめ]、');
    expect(fix?.readingOnly).toBe('そしてしがつごろからポプラがとびはじめ、');
  });

  it('recognises a flag whose fix is already in the sentence', () => {
    const flag = { base: '頃', furigana: 'ころ', assistant: 'ごろ', hasAudio: false };
    expect(readingFlagIsApplied({ inlineReading: '4月[しがつ]頃[ごろ]' }, flag)).toBe(true);
    expect(readingFlagIsApplied({ inlineReading: '4月[しがつ]頃[ころ]' }, flag)).toBe(false);
    expect(readingFlagIsApplied({ inlineReading: '4月[しがつ]頃[ごろ]、5月[ごがつ]頃[ころ]' }, flag)).toBe(false);
  });

  it('leaves non-sound-change, audio-backed, and already-fixed flags alone', () => {
    const sentence = { inlineReading: 'この体[たい]全体[ぜんたい]が' };
    expect(applyReadingFlagFix(sentence, { base: '体', furigana: 'たい', assistant: 'からだ', hasAudio: false })).toBeNull();
    const fixed = { inlineReading: '4月[しがつ]頃[ごろ]' };
    expect(applyReadingFlagFix(fixed, { base: '頃', furigana: 'ころ', assistant: 'ごろ', hasAudio: false })).toBeNull();
    const audio = { inlineReading: '4月[しがつ]頃[ころ]' };
    expect(applyReadingFlagFix(audio, { base: '頃', furigana: 'ころ', assistant: 'ごろ', hasAudio: true })).toBeNull();
  });
});
