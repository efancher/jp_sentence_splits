import { describe, expect, it } from 'vitest';

import type { Sentence, VocabularySuggestion } from '../src/domain/types';
import {
  READING_MISS_WINDOW_DAYS,
  readingCheckTargetKey,
  readingCheckTile,
  recentReadingMisses,
} from '../src/lib/readingMissSteps';
import { readingFeedbackTargetKey } from '../src/lib/wordEvidence';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

type Event = Parameters<typeof recentReadingMisses>[0][number];

function readEvent(sentenceId: string, wordId: string, surface: string, outcome: 'got_it' | 'needed_help', timestamp: string): Event {
  return {
    sentenceId,
    timestamp,
    action: 'target_practice',
    outcome,
    target: { kind: 'vocabulary', key: readingFeedbackTargetKey(wordId), label: surface },
  };
}

function checkEvent(sentenceId: string, timestamp: string): Event {
  return {
    sentenceId,
    timestamp,
    action: 'target_practice',
    outcome: 'needed_help',
    target: { kind: 'expression', key: readingCheckTargetKey(sentenceId), label: 'phrase' },
  };
}

describe('recentReadingMisses', () => {
  it('lists a recent "needed help" on a word reading, newest first, one per sentence', () => {
    const misses = recentReadingMisses(
      [
        readEvent('s1', 'w1', '趣味', 'needed_help', hoursAgo(30)),
        readEvent('s2', 'w2', '猫', 'needed_help', hoursAgo(2)),
        readEvent('s1', 'w3', '魚', 'needed_help', hoursAgo(20)),
      ],
      NOW,
    );
    expect(misses.map((miss) => [miss.sentenceId, miss.surface])).toEqual([
      ['s2', '猫'],
      ['s1', '魚'],
    ]);
  });

  it('forgets a word once its latest reading feedback is a "got it"', () => {
    const events = [readEvent('s1', 'w1', '趣味', 'needed_help', hoursAgo(5)), readEvent('s1', 'w1', '趣味', 'got_it', hoursAgo(1))];
    expect(recentReadingMisses(events, NOW)).toEqual([]);
  });

  it('ignores misses older than the window and unrelated events', () => {
    const old = readEvent('s1', 'w1', '趣味', 'needed_help', hoursAgo(24 * (READING_MISS_WINDOW_DAYS + 1)));
    const meaning: Event = { ...readEvent('s1', 'w2', '猫', 'needed_help', hoursAgo(1)), target: { kind: 'vocabulary', key: 'vocab:w2', label: '猫' } };
    expect(recentReadingMisses([old, meaning], NOW)).toEqual([]);
  });

  it('treats a reading check logged at or after the miss as having covered it', () => {
    const miss = readEvent('s1', 'w1', '趣味', 'needed_help', hoursAgo(5));
    expect(recentReadingMisses([miss, checkEvent('s1', hoursAgo(5))], NOW)).toEqual([]);
    expect(recentReadingMisses([miss, checkEvent('s1', hoursAgo(1))], NOW)).toEqual([]);
    // A fresh tap-miss after the check is due again.
    const again = readEvent('s1', 'w1', '趣味', 'needed_help', hoursAgo(0.5));
    expect(recentReadingMisses([miss, checkEvent('s1', hoursAgo(1)), again], NOW)).toHaveLength(1);
  });
});

describe('readingCheckTile', () => {
  const pieces: [string, string, string][] = [
    ['私', '代名詞', 'ワタシ'],
    ['は', '助詞/係助詞', 'ハ'],
    ['趣味', '名詞/普通名詞/一般', 'シュミ'],
    ['が', '助詞/格助詞', 'ガ'],
    ['多い', '形容詞/一般', 'オオイ'],
    ['です', '助動詞', 'デス'],
    ['。', '補助記号/句点', ''],
  ];
  function build(readings = true): Pick<Sentence, 'japanese' | 'vocabularySuggestions'> {
    let cursor = 0;
    const suggestions: VocabularySuggestion[] = pieces.map(([surface, pos, reading], i) => {
      const token: VocabularySuggestion = {
        id: `t${i}`,
        surface,
        start: cursor,
        end: cursor + surface.length,
        expression: surface,
        reading: readings ? reading : '',
        pos,
        source: 'morphology',
        selectedByDefault: false,
      };
      cursor += surface.length;
      return token;
    });
    return { japanese: pieces.map((p) => p[0]).join(''), vocabularySuggestions: suggestions };
  }

  it('returns the phrase holding the word with its reading', () => {
    const found = readingCheckTile(build(), '趣味');
    expect(found?.tile.text).toBe('趣味が');
    expect(found?.tile.reading).toBe('シュミが');
    expect(found?.tile.before).toBe('私は');
  });

  it('returns null when the word is not in the sentence or the phrase has no reading', () => {
    expect(readingCheckTile(build(), '犬')).toBeNull();
    expect(readingCheckTile(build(false), '趣味')).toBeNull();
  });
});
