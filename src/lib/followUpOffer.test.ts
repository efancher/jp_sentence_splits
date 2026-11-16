import { describe, expect, it } from 'vitest';
import { chooseFollowUp, chooseFollowUpForCause, FOLLOW_UP_ASPECT, FOLLOW_UP_RANDOM_RATE } from './followUpOffer';

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
    expect(FOLLOW_UP_ASPECT).toEqual({
      tiles: 'listening', dictate: 'listening', meaning: 'meaning', shadow: 'pronunciation', reading: 'reading', grammar: 'grammar',
    });
  });

  it('never offers the cause-only checks (Reading, Grammar) by rule or random draw', () => {
    const withCauseOnly = [...ALL, 'reading', 'grammar'] as const;
    for (const draw of [0, FOLLOW_UP_RANDOM_RATE + 0.01]) {
      for (const pick of [0, 0.5, 0.99]) {
        expect(['reading', 'grammar']).not.toContain(chooseFollowUp({ available: withCauseOnly, draw, pick })!.tool);
      }
    }
    expect(chooseFollowUp({ available: ['grammar'], draw: 0.9, pick: 0 })).toBeNull();
  });
});

describe('chooseFollowUpForCause', () => {
  it('offers the tool that answers the named cause, labelled as the learner\'s', () => {
    const all = [...ALL, 'reading', 'grammar'] as const;
    expect(chooseFollowUpForCause({ available: all, cause: 'reading' })).toEqual({ tool: 'reading', source: 'learner' });
    expect(chooseFollowUpForCause({ available: all, cause: 'meaning' })).toEqual({ tool: 'meaning', source: 'learner' });
    expect(chooseFollowUpForCause({ available: all, cause: 'grammar' })).toEqual({ tool: 'grammar', source: 'learner' });
    expect(chooseFollowUpForCause({ available: all, cause: 'listening' })).toEqual({ tool: 'dictate', source: 'learner' });
    expect(chooseFollowUpForCause({ available: ['tiles', 'meaning'], cause: 'listening' })).toEqual({ tool: 'tiles', source: 'learner' });
  });

  it('returns null when nothing can answer it, so the caller falls back to the rule', () => {
    expect(chooseFollowUpForCause({ available: ALL, cause: 'reading' })).toBeNull();
    expect(chooseFollowUpForCause({ available: ['meaning'], cause: 'listening' })).toBeNull();
    expect(chooseFollowUpForCause({ available: ALL, cause: 'grammar' })).toBeNull();
  });
});
