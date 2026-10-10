import { describe, expect, it } from 'vitest';
import type { FsrsState } from '../domain/types';
import { sentenceStage } from './sentenceStages';

function item(state: FsrsState['state'], scheduledDays = 0) {
  return { fsrsState: { state, scheduledDays } as FsrsState };
}

describe('sentenceStage', () => {
  it('is new with no study items or only new ones', () => {
    expect(sentenceStage([], 180)).toBe('new');
    expect(sentenceStage([item('new')], 180)).toBe('new');
  });

  it('maps a single item by state and interval', () => {
    expect(sentenceStage([item('learning')], 180)).toBe('learning');
    expect(sentenceStage([item('relearning', 30)], 180)).toBe('learning');
    expect(sentenceStage([item('review', 5)], 180)).toBe('young');
    expect(sentenceStage([item('review', 40)], 180)).toBe('mature');
    expect(sentenceStage([item('review', 200)], 180)).toBe('graduated');
  });

  it('uses the weakest item', () => {
    expect(sentenceStage([item('review', 200), item('review', 5)], 180)).toBe('young');
    expect(sentenceStage([item('review', 200), item('new')], 180)).toBe('new');
  });

  it('never graduates when graduation is off', () => {
    expect(sentenceStage([item('review', 400)], 0)).toBe('mature');
  });
});
