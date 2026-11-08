import { describe, expect, it } from 'vitest';
import { chooseFollowUp, FOLLOW_UP_ASPECT, FOLLOW_UP_RANDOM_RATE } from './followUpOffer';

const ALL = ['meaning', 'tiles', 'dictate', 'shadow'] as const;

describe('chooseFollowUp', () => {
  it('offers nothing when no tool can open', () => {
    expect(chooseFollowUp({ available: [], draw: 0.9, pick: 0 })).toBeNull();
  });

  it('follows the rule outside the random share: Dictation before Ear tiles, Word check only for a weak word', () => {
    const draw = FOLLOW_UP_RANDOM_RATE + 0.01;
    expect(chooseFollowUp({ available: ALL, draw, pick: 0 })).toEqual({ tool: 'dictate', source: 'rule' });
    expect(chooseFollowUp({ available: ['tiles', 'shadow'], draw, pick: 0 })).toEqual({ tool: 'tiles', source: 'rule' });
    expect(chooseFollowUp({ available: ALL, weakWord: true, draw, pick: 0 })).toEqual({ tool: 'meaning', source: 'rule' });
    expect(chooseFollowUp({ available: ['dictate', 'shadow'], draw, pick: 0 })).toEqual({ tool: 'dictate', source: 'rule' });
  });

  it('falls back to Word check when it is the only tool left', () => {
    expect(chooseFollowUp({ available: ['meaning'], draw: 0.9, pick: 0 })).toEqual({ tool: 'meaning', source: 'rule' });
  });

  it('draws uniformly among the available tools in the random share and labels it random', () => {
    expect(chooseFollowUp({ available: ALL, draw: 0, pick: 0 })).toEqual({ tool: 'meaning', source: 'random' });
    expect(chooseFollowUp({ available: ALL, draw: 0, pick: 0.99 })).toEqual({ tool: 'shadow', source: 'random' });
    expect(chooseFollowUp({ available: ['tiles', 'shadow'], draw: 0.1, pick: 0.6 })).toEqual({ tool: 'shadow', source: 'random' });
  });

  it('maps every tool to the aspect it supports', () => {
    expect(FOLLOW_UP_ASPECT).toEqual({ tiles: 'listening', dictate: 'listening', meaning: 'meaning', shadow: 'pronunciation' });
  });
});
