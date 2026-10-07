import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StructureChecks } from '../src/components/StructureChecks';
import { roleForChunk } from '../src/lib/chunking';
import type { GlossChunk } from '../src/lib/glossSkill';
import {
  buildAttachmentCheck,
  buildCutDownCheck,
  buildStructureChecks,
  gradeCutDown,
} from '../src/lib/structureChecks';

function chunksOf(texts: string[]): GlossChunk[] {
  return texts.map((japanese, index) => ({
    id: `c${index}`,
    japanese,
    role: roleForChunk(japanese, index === texts.length - 1),
  }));
}

const FULL = chunksOf(['私は', '毎日', '公園で', '犬の', '散歩を', 'します']);
const idOf = (chunks: GlossChunk[], text: string) => chunks.find((c) => c.japanese === text)!.id;

describe('cut-down check', () => {
  it('keeps the predicate and が/は/を chunks, and flags で/から/まで/より as clear extras', () => {
    const check = buildCutDownCheck(FULL)!;
    expect(check.keepIds).toEqual(['私は', '散歩を', 'します'].map((t) => idOf(FULL, t)));
    expect(check.extraIds).toEqual([idOf(FULL, '公園で')]);
    expect(check.graded).toBe(true);
  });

  it('grades a lenient cut: free chunks (毎日, 犬の) may go either way', () => {
    const check = buildCutDownCheck(FULL)!;
    const core = check.keepIds;
    expect(gradeCutDown(check, new Set(core)).correct).toBe(true);
    expect(gradeCutDown(check, new Set([...core, idOf(FULL, '毎日'), idOf(FULL, '犬の')])).correct).toBe(true);
    const keptExtra = gradeCutDown(check, new Set([...core, idOf(FULL, '公園で')]));
    expect(keptExtra).toMatchObject({ correct: false, keptExtras: [idOf(FULL, '公園で')] });
    const cutCore = gradeCutDown(check, new Set(core.slice(1)));
    expect(cutCore).toMatchObject({ correct: false, droppedCore: [core[0]] });
  });

  it('compares rather than grades when there is no clear extra', () => {
    const check = buildCutDownCheck(chunksOf(['私は', 'とても', '猫が', '好きです']))!;
    expect(check.graded).toBe(false);
    expect(gradeCutDown(check, new Set(check.chunks.map((c) => c.id))).correct).toBeNull();
  });

  it('is skipped when there is nothing to cut or too little sentence', () => {
    expect(buildCutDownCheck(chunksOf(['私は', '猫が', '好きです']))).toBeNull();
    expect(buildCutDownCheck(chunksOf(['猫が', 'います']))).toBeNull();
  });
});

describe('attachment check', () => {
  it('asks forward and reverse across sentences, always with a consistent answer', () => {
    const directions = new Set<string>();
    for (let n = 0; n < 30; n += 1) {
      const check = buildAttachmentCheck(FULL, `seed-${n}`)!;
      directions.add(check.direction);
      expect(check.modifierId).toBe(idOf(FULL, '犬の'));
      expect(check.headId).toBe(idOf(FULL, '散歩を'));
      if (check.direction === 'forward') {
        expect([check.askedId, check.answerId]).toEqual([check.modifierId, check.headId]);
      } else {
        expect([check.askedId, check.answerId]).toEqual([check.headId, check.modifierId]);
      }
    }
    expect(directions).toEqual(new Set(['forward', 'reverse']));
  });

  it('needs an Aの chunk', () => {
    expect(buildAttachmentCheck(chunksOf(['私は', '公園で', '走ります']), 's')).toBeNull();
  });
});

describe('StructureChecks', () => {
  function setup() {
    const checks = buildStructureChecks(FULL, 'seed-0');
    const onRecord = vi.fn();
    const onFinish = vi.fn();
    render(<StructureChecks sentenceId="s1" visitId="v1" checks={checks} onRecord={onRecord} onFinish={onFinish} />);
    return { checks, onRecord, onFinish };
  }

  it('walks cut-down then attachment, logging each and finishing after the last', () => {
    const { checks, onRecord, onFinish } = setup();
    fireEvent.click(screen.getByRole('button', { name: '公園で' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check my cut' }));
    expect(screen.getByText(/Clean cut/)).toBeInTheDocument();
    expect(onRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({ skill: 'predicate', ruleKey: 'predicate:cut-down', firstCorrect: true, outcome: 'independent_correct' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    const answer = FULL.find((c) => c.id === checks.attachment!.answerId)!;
    const wrong = FULL.find((c) => ![checks.attachment!.askedId, checks.attachment!.answerId].includes(c.id))!;
    fireEvent.click(screen.getByRole('button', { name: wrong.japanese }));
    fireEvent.click(screen.getByRole('button', { name: answer.japanese }));
    expect(onRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({ skill: 'attachment', ruleKey: 'attachment:の:tap', firstCorrect: false, outcome: 'assisted_correct' }),
    );
    expect(onFinish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('never logs an unresolved outcome for a wrong cut', () => {
    const { onRecord } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Check my cut' }));
    expect(screen.getByText('Not quite')).toBeInTheDocument();
    expect(onRecord.mock.calls[0]![0]).toMatchObject({ firstCorrect: false, outcome: 'assisted_correct' });
  });
});
