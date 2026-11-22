import { describe, expect, it } from 'vitest';

import { activeMarkedWords, markableSurfaces, markedSurfacesIn, markedWordKey } from '../src/lib/markedWords';

type Ev = Parameters<typeof activeMarkedWords>[0][number];
const mark = (surface: string, at: string, marked = true): Ev => ({
  action: 'phrase_shadow', timestamp: at, outcome: marked ? 'needed_help' : 'got_it', target: { kind: 'expression', key: markedWordKey(surface), label: surface },
});
const pass = (label: string, at: string, outcome: 'got_it' | 'close' = 'got_it', key = 'phrase-shadow:'): Ev => ({
  action: 'phrase_shadow', timestamp: at, outcome, target: { kind: 'expression', key, label },
});

describe('activeMarkedWords', () => {
  it('keeps a mark until Got it passes land on two different days', () => {
    const base = [mark('だから', '2026-11-01T10:00:00Z')];
    expect(activeMarkedWords(base)).toEqual([{ surface: 'だから', markedAt: '2026-11-01T10:00:00Z' }]);
    // Two Got its the same day, a Close, and a pass before the mark do not retire it.
    const sameDay = [...base, pass('だから行く', '2026-11-02T09:00:00Z'), pass('だから行く', '2026-11-02T09:05:00Z'), pass('だから', '2026-11-03T09:00:00Z', 'close'), pass('だから', '2026-10-30T09:00:00Z')];
    expect(activeMarkedWords(sameDay)).toHaveLength(1);
    // A second Got it on another day, over a phrase containing the word (even a chain rung), clears it.
    const done = [...sameDay, pass('だから行く', '2026-11-04T12:00:00Z', 'got_it', 'chain-rung:2')];
    expect(activeMarkedWords(done)).toEqual([]);
  });

  it('ignores cold tries and passes that do not contain the word', () => {
    const events = [
      mark('だから', '2026-11-01T10:00:00Z'),
      pass('だから行く', '2026-11-02T09:00:00Z', 'got_it', 'chain-cold:0'),
      pass('だから行く', '2026-11-03T09:00:00Z', 'got_it', 'chain-cold:0'),
      pass('行く', '2026-11-04T09:00:00Z'),
      pass('行く', '2026-11-05T09:00:00Z'),
    ];
    expect(activeMarkedWords(events)).toHaveLength(1);
  });

  it('unmarking removes it, and marking again restarts the count', () => {
    const events = [
      mark('だから', '2026-11-01T10:00:00Z'),
      mark('だから', '2026-11-01T10:05:00Z', false),
    ];
    expect(activeMarkedWords(events)).toEqual([]);
    const remarked = [...events, mark('だから', '2026-11-10T10:00:00Z'), pass('だから', '2026-11-02T09:00:00Z'), pass('だから', '2026-11-03T09:00:00Z')];
    expect(activeMarkedWords(remarked)).toEqual([{ surface: 'だから', markedAt: '2026-11-10T10:00:00Z' }]);
  });
});

describe('marked word helpers', () => {
  it('finds marked surfaces in a sentence, longest first', () => {
    const marked = [{ surface: '行く', markedAt: 'a' }, { surface: '行く前に', markedAt: 'b' }];
    expect(markedSurfacesIn('駅に行く前に買う', marked)).toEqual(['行く前に', '行く']);
    expect(markedSurfacesIn('寝る', marked)).toEqual([]);
  });

  it('lists the markable surfaces inside a step, deduplicated', () => {
    const suggestions = [{ surface: '昨日' }, { surface: '映画' }, { surface: '映画' }, { surface: '' }];
    expect(markableSurfaces(suggestions, '友達と映画を')).toEqual(['映画']);
    const withPos = [{ surface: '友達', pos: '名詞/普通名詞' }, { surface: 'と', pos: '助詞/格助詞' }, { surface: '、', pos: '補助記号/読点' }];
    expect(markableSurfaces(withPos, '友達と、')).toEqual(['友達']);
  });
});
