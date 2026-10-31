import { describe, expect, it } from 'vitest';
import {
  NO_AUTO_LINK_FAMILY,
  planGrammarMerge,
  type LinkRow,
  type PatternRow,
} from '../scripts/lib/grammarPatternMerge';

const pattern = (id: string, canonicalName: string, extra: Partial<PatternRow> = {}): PatternRow => ({
  id,
  canonicalName,
  aliases: [],
  family: null,
  ...extra,
});
const link = (id: string, sentenceId: string, patternId: string, extra: Partial<LinkRow> = {}): LinkRow => ({
  id,
  sentenceId,
  patternId,
  surfaceForm: null,
  occurrenceExplanation: null,
  confirmedByLearner: false,
  ...extra,
});

const base = {
  studyItems: [],
  relationships: [],
  flagNames: [],
  groups: [{ canonical: '～ている', members: ['～ています', '～てる'] }],
};

describe('planGrammarMerge', () => {
  it('keeps the pattern with the most encounters, renames it and keeps old names as aliases', () => {
    const plan = planGrammarMerge({
      ...base,
      patterns: [pattern('a', '～ています'), pattern('b', '～てる', { aliases: ['てん'] })],
      links: [link('l1', 's1', 'a'), link('l2', 's2', 'b'), link('l3', 's3', 'b')],
    });
    const group = plan.groups[0]!;
    expect(group.survivor.id).toBe('b');
    expect(group.losers.map((p) => p.id)).toEqual(['a']);
    expect(group.normalizedKey).toBe('ている');
    expect(group.aliases.sort()).toEqual(['てん', '～てる', '～ています'].sort());
    expect(group.repointLinks).toEqual([{ id: 'l1', toPatternId: 'b', confirmed: false }]);
  });

  it('merges a loser link into the survivor link for the same sentence and carries missing detail', () => {
    const plan = planGrammarMerge({
      ...base,
      patterns: [pattern('a', '～ています'), pattern('b', '～てる')],
      links: [
        link('l1', 's1', 'a', { surfaceForm: '住んでいます', occurrenceExplanation: 'state', confirmedByLearner: true }),
        link('l2', 's1', 'b'),
        link('l3', 's2', 'b'),
      ],
    });
    const group = plan.groups[0]!;
    expect(group.survivor.id).toBe('b');
    expect(group.repointLinks).toEqual([]);
    expect(group.mergeAndDeleteLinks).toEqual([
      { id: 'l1', survivorLinkId: 'l2', surfaceForm: '住んでいます', occurrenceExplanation: 'state', confirmed: true },
    ]);
  });

  it('repoints a card, but blocks the group on a card collision or a relationship', () => {
    const patterns = [pattern('a', '～ています'), pattern('b', '～てる')];
    const links = [link('l1', 's1', 'b')];
    const ok = planGrammarMerge({
      ...base,
      patterns,
      links,
      studyItems: [{ id: 'c1', subjectId: 'a', activityType: 'grammar_completion' }],
    });
    expect(ok.groups[0]!.repointStudyItems).toEqual([{ id: 'c1', toPatternId: 'b' }]);
    expect(ok.groups[0]!.blocked).toBeNull();

    const collide = planGrammarMerge({
      ...base,
      patterns,
      links,
      studyItems: [
        { id: 'c1', subjectId: 'a', activityType: 'grammar_completion' },
        { id: 'c2', subjectId: 'b', activityType: 'grammar_completion' },
      ],
    });
    expect(collide.groups[0]!.blocked).toMatch(/resolve by hand/);

    const related = planGrammarMerge({
      ...base,
      patterns,
      links,
      relationships: [{ id: 'r1', patternAId: 'a', patternBId: 'z' }],
    });
    expect(related.groups[0]!.blocked).toMatch(/relationship/);
  });

  it('blocks when the new canonical key belongs to an unrelated live pattern', () => {
    const plan = planGrammarMerge({
      ...base,
      patterns: [pattern('a', '～ています'), pattern('b', '～てる'), pattern('c', 'ている')],
      links: [],
    });
    expect(plan.groups[0]!.blocked).toMatch(/already used/);
  });

  it('reports missing members and skips a group with fewer than two', () => {
    const plan = planGrammarMerge({ ...base, patterns: [pattern('a', '～ています')], links: [] });
    expect(plan.groups).toEqual([]);
    expect(plan.problems.join('\n')).toMatch(/no live pattern named "～てる"/);
  });

  it('flags only patterns with an empty family and is quiet about ones already flagged', () => {
    const plan = planGrammarMerge({
      ...base,
      groups: [],
      patterns: [
        pattern('a', 'すごい'),
        pattern('b', 'どう', { family: 'discourse' }),
        pattern('c', 'ちょっと', { family: NO_AUTO_LINK_FAMILY }),
      ],
      links: [],
      flagNames: ['すごい', 'どう', 'ちょっと', 'ない'],
    });
    expect(plan.flags).toEqual([{ id: 'a', canonicalName: 'すごい' }]);
    expect(plan.problems).toHaveLength(2);
    expect(plan.problems.join('\n')).toMatch(/already has family "discourse"/);
    expect(plan.problems.join('\n')).toMatch(/no live pattern named "ない"/);
  });

  it('uses keep and shortMeaning instead of the busiest member', () => {
    const plan = planGrammarMerge({
      ...base,
      groups: [{ canonical: '～ている', members: ['～ています', '～てる'], keep: '～てる', shortMeaning: 'ongoing or resulting' }],
      patterns: [pattern('a', '～ています'), pattern('b', '～てる')],
      links: [link('l1', 's1', 'a'), link('l2', 's2', 'a')],
    });
    expect(plan.groups[0]!.survivor.id).toBe('b');
    expect(plan.groups[0]!.shortMeaning).toBe('ongoing or resulting');
    expect(plan.groups[0]!.repointLinks).toHaveLength(2);
  });
});
