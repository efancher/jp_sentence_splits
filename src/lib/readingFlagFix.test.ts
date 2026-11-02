import { describe, expect, it } from 'vitest';

import { applyReadingFlagFix, parseReadingFlagNote } from './readingFlagFix';

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

  it('leaves non-sound-change, audio-backed, and already-fixed flags alone', () => {
    const sentence = { inlineReading: 'この体[たい]全体[ぜんたい]が' };
    expect(applyReadingFlagFix(sentence, { base: '体', furigana: 'たい', assistant: 'からだ', hasAudio: false })).toBeNull();
    const fixed = { inlineReading: '4月[しがつ]頃[ごろ]' };
    expect(applyReadingFlagFix(fixed, { base: '頃', furigana: 'ころ', assistant: 'ごろ', hasAudio: false })).toBeNull();
    const audio = { inlineReading: '4月[しがつ]頃[ころ]' };
    expect(applyReadingFlagFix(audio, { base: '頃', furigana: 'ころ', assistant: 'ごろ', hasAudio: true })).toBeNull();
  });
});
