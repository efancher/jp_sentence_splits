import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StructureChecks } from '../src/components/StructureChecks';
import { roleForChunk } from '../src/lib/chunking';
import type { GlossChunk } from '../src/lib/glossSkill';
import {
  buildDescribesCheck,
  buildRolesCheck,
  buildStructureChecks,
  gradeDescribes,
} from '../src/lib/structureChecks';

function chunksOf(texts: string[]): GlossChunk[] {
  return texts.map((japanese, index) => ({
    id: `c${index}`,
    japanese,
    role: roleForChunk(japanese, index === texts.length - 1),
  }));
}

const idOf = (chunks: GlossChunk[], text: string) => chunks.find((c) => c.japanese === text)!.id;

const ROLES = chunksOf(['私は', '公園で', '犬を', '散歩します']);

describe('roles check', () => {
  it('asks for a role marked by exactly one chunk and answers it by particle', () => {
    const seen = new Set<string>();
    for (let n = 0; n < 40; n += 1) {
      const check = buildRolesCheck(ROLES, `seed-${n}`)!;
      seen.add(check.role);
      const expected = { place: '公園で', receiver: '犬を' }[check.role as 'place' | 'receiver'];
      expect(check.answerId).toBe(idOf(ROLES, expected));
      expect(check.predicateId).toBe(idOf(ROLES, '散歩します'));
    }
    expect(seen).toEqual(new Set(['place', 'receiver']));
  });

  it('skips a role marked twice, and sentences too short to be a real choice', () => {
    const twice = chunksOf(['本を', '雑誌を', '朝に', '読みます']);
    expect(buildRolesCheck(twice, 's')).toBeNull();
    expect(buildRolesCheck(chunksOf(['犬を', '見ます']), 's')).toBeNull();
    expect(buildRolesCheck(chunksOf(['私は', '犬を', '見ます']), 's')).toBeNull();
  });

  it('skips multi-clause sentences', () => {
    expect(buildRolesCheck(chunksOf(['私は', '家で', '食べました', '犬を', '見ます']), 's')).toBeNull();
  });
});

describe('describes check', () => {
  const CHAIN = chunksOf(['私の', '友達の', '犬が', '公園で', '走ります']);
  const CLAUSE = chunksOf(['昨日', '駅で', '買った', '本を', '読みます']);

  it('offers an の chain only when it is two or more の deep', () => {
    const check = buildDescribesCheck(CHAIN, 's')!;
    expect(check).toMatchObject({ kind: 'chain', headId: idOf(CHAIN, '犬が') });
    expect(check.requiredIds).toEqual([idOf(CHAIN, '私の'), idOf(CHAIN, '友達の')]);
    expect(buildDescribesCheck(chunksOf(['友達の', '犬が', '公園で', '走ります']), 's')).toBeNull();
  });

  it('treats a plain verb right before a noun as describing it, with its own where/when optional', () => {
    const check = buildDescribesCheck(CLAUSE, 's')!;
    expect(check).toMatchObject({ kind: 'clause', headId: idOf(CLAUSE, '本を'), requiredIds: [idOf(CLAUSE, '買った')] });
    expect(new Set(check.freeIds)).toEqual(new Set([idOf(CLAUSE, '昨日'), idOf(CLAUSE, '駅で')]));
  });

  it('does not treat a polite verb as a modifier', () => {
    expect(buildDescribesCheck(chunksOf(['昨日', '買いました', '本を', '読みます']), 's')).toBeNull();
  });

  it('grades required, free and wrong taps', () => {
    const check = buildDescribesCheck(CLAUSE, 's')!;
    const verb = idOf(CLAUSE, '買った');
    expect(gradeDescribes(check, new Set([verb])).correct).toBe(true);
    expect(gradeDescribes(check, new Set([verb, idOf(CLAUSE, '駅で')])).correct).toBe(true);
    expect(gradeDescribes(check, new Set([idOf(CLAUSE, '駅で')]))).toMatchObject({ correct: false, missed: [verb] });
    expect(gradeDescribes(check, new Set([verb, idOf(CLAUSE, '読みます')]))).toMatchObject({ correct: false, wrong: [idOf(CLAUSE, '読みます')] });
  });
});

describe('StructureChecks', () => {
  function setup() {
    const chunks = chunksOf(['私の', '友達の', '犬が', '公園で', '走ります']);
    const checks = buildStructureChecks(chunks, 'seed-0');
    const onRecord = vi.fn();
    const onFinish = vi.fn();
    render(<StructureChecks sentenceId="s1" visitId="v1" checks={checks} onRecord={onRecord} onFinish={onFinish} />);
    return { chunks, checks, onRecord, onFinish };
  }

  it('walks roles then describes, logging each and finishing after the last', () => {
    const { chunks, checks, onRecord, onFinish } = setup();
    const answer = chunks.find((c) => c.id === checks.roles!.answerId)!;
    const wrong = chunks.find((c) => c.id !== checks.roles!.answerId && c.id !== checks.roles!.predicateId)!;
    fireEvent.click(screen.getByRole('button', { name: wrong.japanese }));
    fireEvent.click(screen.getByRole('button', { name: answer.japanese }));
    expect(onRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({ skill: 'particle', firstCorrect: false, outcome: 'assisted_correct' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    fireEvent.click(screen.getByRole('button', { name: '私の' }));
    fireEvent.click(screen.getByRole('button', { name: '友達の' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByText(/whole description/)).toBeInTheDocument();
    expect(onRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({ skill: 'attachment', ruleKey: 'attachment:chain:describes', outcome: 'independent_correct' }),
    );
    expect(onFinish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
