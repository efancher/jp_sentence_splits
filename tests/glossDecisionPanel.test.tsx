import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { GlossDecisionPanel, type GlossDecisionInput } from '../src/components/GlossDecisionPanel';
import type { GlossDecision } from '../src/domain/types';
import { previewHeuristicChunks } from '../src/lib/analysisHelpers';

const preview = previewHeuristicChunks('ケーキを食べた。');
const chunks = preview.parts.map((japanese, i) => ({ id: `c${i}`, japanese, role: preview.roles[i] ?? '' }));
const words = [{ expression: '食べる', reading: 'たべる', english: 'to eat' }];

let n = 0;
const settled = (overrides: Partial<GlossDecision>): GlossDecision => {
  n += 1;
  return {
    id: `g${n}`, timestamp: new Date(Date.UTC(2026, 8, 1, 0, n)).toISOString(), visitId: 'v', bookId: 'b', sentenceId: `s${n}`,
    skill: 'particle', subskill: 'case', ruleKey: 'particle:を', targetText: 'ケーキを', levelShown: 3, firstResponse: 'object',
    firstCorrect: true, referenceValue: 'object', referenceConfidence: 'settled', hintMaxStep: 0, explanationOpened: false,
    vocabHelped: false, translationLevel: 1, outcome: 'independent_correct', ...overrides,
  };
};

function setup(records: GlossDecision[]) {
  const onRecord = vi.fn<(d: GlossDecisionInput) => void>();
  const onFinish = vi.fn();
  render(
    <GlossDecisionPanel sentenceId="s" visitId="v1" chunks={chunks} records={records} translation="I ate the cake." words={words} onRecord={onRecord} onFinish={onFinish} />,
  );
  return { onRecord, onFinish };
}

describe('GlossDecisionPanel', () => {
  it('opens a first-time skill with a worked example that is recorded as ungraded', async () => {
    const { onRecord } = setup([]);
    expect(screen.getByText(/Worked example/)).toBeTruthy();
    expect(screen.getByText('I ate the cake.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ skill: 'predicate', levelShown: 1, outcome: 'ungraded', firstCorrect: null }));
  });

  it('records an unhinted correct first answer as independent', async () => {
    const records = [settled({ skill: 'predicate' }), settled({ skill: 'predicate' }), settled({ skill: 'predicate' }), settled({}), settled({ outcome: 'assisted_correct' }), settled({ outcome: 'assisted_correct' })];
    const { onRecord } = setup(records);
    await userEvent.click(screen.getByRole('button', { name: '食べた。' }));
    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ skill: 'predicate', outcome: 'independent_correct', firstCorrect: true, hintMaxStep: 0 }));
  });

  it('lets a wrong first answer be retried without losing place, and records it as assisted', async () => {
    const records = [settled({ skill: 'predicate', outcome: 'assisted_correct' }), settled({ skill: 'predicate', outcome: 'assisted_correct' }), settled({ skill: 'predicate', outcome: 'assisted_correct' })];
    const { onRecord } = setup(records);
    await userEvent.click(screen.getByRole('button', { name: 'ケーキを' }));
    expect(onRecord).not.toHaveBeenCalled();
    expect(screen.getByText(/try again/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '食べた。' }));
    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'assisted_correct', firstCorrect: false, firstResponse: 'c0' }));
  });

  it('a word-help request records the blocker and that vocab helped, without counting as a miss', async () => {
    const records = [settled({ skill: 'predicate', outcome: 'assisted_correct' }), settled({ skill: 'predicate', outcome: 'assisted_correct' }), settled({ skill: 'predicate', outcome: 'assisted_correct' })];
    const { onRecord } = setup(records);
    await userEvent.click(screen.getByRole('button', { name: 'A word' }));
    await userEvent.click(screen.getByRole('button', { name: '食べた。' }));
    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ blocker: 'word', vocabHelped: true, outcome: 'assisted_correct', hintMaxStep: 1 }));
  });

  it('records a dispute as disputed, not a failure', async () => {
    const records = [settled({ skill: 'predicate', outcome: 'assisted_correct' }), settled({ skill: 'predicate', outcome: 'assisted_correct' }), settled({ skill: 'predicate', outcome: 'assisted_correct' })];
    const { onRecord } = setup(records);
    await userEvent.click(screen.getByRole('button', { name: 'ケーキを' }));
    await userEvent.click(screen.getByRole('button', { name: /another answer works/ }));
    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'disputed' }));
  });

  it('"Try unaided" records the independent level and hides glosses', async () => {
    const records = [settled({ skill: 'predicate', outcome: 'assisted_correct' }), settled({ skill: 'predicate', outcome: 'assisted_correct' }), settled({ skill: 'predicate', outcome: 'assisted_correct' })];
    const { onRecord } = setup(records);
    expect(screen.getByText(/to eat/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Try unaided' }));
    expect(screen.queryByText(/to eat/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '食べた。' }));
    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ levelShown: 4, translationLevel: 0 }));
  });

  it('logs a self-report row from the too easy / right / too hard prompt without touching grading', async () => {
    const records = (['predicate', 'particle'] as const).flatMap((skill) => [1, 2, 3].map(() => settled({ skill, outcome: 'assisted_correct' })));
    const { onRecord } = setup(records);
    await userEvent.click(screen.getByRole('button', { name: '食べた。' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next check' }));
    await userEvent.click(screen.getByRole('button', { name: 'what the action is done to' }));
    await userEvent.click(screen.getByRole('button', { name: 'Too easy' }));
    expect(onRecord).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'self_report', felt: 'too_easy', firstCorrect: null }));
  });

  it('after three independent successes the next sentence hides the translation (support later changes)', () => {
    const records = [settled({ skill: 'predicate' }), settled({ skill: 'predicate' }), settled({ skill: 'predicate' })];
    setup(records);
    expect(screen.getByText(/Independent/)).toBeTruthy();
    expect(screen.queryByText('I ate the cake.')).toBeNull();
    expect(screen.queryByText('to eat')).toBeNull();
  });
});
