import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CLAUSE_PILOT } from '../src/data/clausePilot';
import { ClausePilotPreview } from '../src/components/ClausePilotPreview';
import { clauseQuestionAvailability, clausePilotFor, uniqueTextSpan, clausePilotFeedbackKey } from '../src/lib/clausePilot';
import { PILOT_CHUNK_REPAIRS, repairPilotChunks } from '../src/lib/pilotChunkRepairs';
import type { AnalysisChunk } from '../src/domain/types';

beforeEach(() => localStorage.clear());
describe('clause preview references', () => {
  it('validates every pilot and refuses stale text or ambiguous spans', () => {
    expect(CLAUSE_PILOT).toHaveLength(416);
    expect(new Set(CLAUSE_PILOT.map((reference) => reference.id)).size).toBe(CLAUSE_PILOT.length);
    expect(new Set(CLAUSE_PILOT.map((reference) => reference.source)).size).toBe(CLAUSE_PILOT.length);
    for (const reference of CLAUSE_PILOT) expect(clausePilotFor(reference.source)).toBe(reference);
    expect(clausePilotFor(CLAUSE_PILOT[0].source + '変更')).toBeNull();
    expect(uniqueTextSpan('木と木', '木')).toBeNull();
    expect(uniqueTextSpan('𠮷田が見た木', '木')).toEqual({ start: 6, end: 7 });
    expect(clausePilotFor(CLAUSE_PILOT[0].source, [{ ...CLAUSE_PILOT[0], answerText: 'invented' }])).toBeNull();
  });
  it('lets a learner attempt, reveal and dispute without showing a score, and resets on another sentence', async () => {
    const first = CLAUSE_PILOT[0];
    const { container, rerender } = render(<ClausePilotPreview japanese={first.source} />);
    expect(screen.queryByText(first.explanation)).not.toBeInTheDocument();
    const details = container.querySelector('details')!;
    details.open = true; fireEvent(details, new Event('toggle'));
    expect(await screen.findByLabelText('Sentence with the target highlighted')).toHaveTextContent(first.source);
    expect(container.querySelector('mark')).toHaveTextContent(first.targetText);
    fireEvent.click(screen.getByRole('button', { name: first.options[1], exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Show explanation' }));
    expect(screen.getByText(first.explanation)).toBeVisible();
    expect(screen.queryByText(/incorrect|correct!|score:/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Another answer works' }));
    expect(localStorage.getItem(clausePilotFeedbackKey(first.id))).toBe('disputed');
    rerender(<ClausePilotPreview japanese={CLAUSE_PILOT[1].source} />);
    expect(screen.queryByText(first.explanation)).not.toBeInTheDocument();
    expect(container.querySelector('details')?.open).toBe(false);
  });
});

describe('reviewed saved-chunk repairs', () => {
  it.each(PILOT_CHUNK_REPAIRS)('preserves text, ids and unrelated fields for $sentenceId, and is idempotent', (repair) => {
    const pair = repair.before.join('');
    const at = repair.source.indexOf(pair);
    const parts = [repair.source.slice(0, at), ...repair.before, repair.source.slice(at + pair.length)];
    const original: AnalysisChunk[] = parts.map((japanese, order) => ({ id: `c${order}`, order, japanese, role: 'old', literalEnglish: 'old' }));
    const fixed = repairPilotChunks(repair.sentenceId, repair.source, original)!;
    expect(fixed.map((c) => c.japanese).join('')).toBe(repair.source);
    expect(fixed.map((c) => c.id)).toEqual(original.map((c) => c.id));
    expect(fixed[0]).toBe(original[0]);
    expect(fixed.slice(1, 3).map((c) => c.japanese)).toEqual(repair.after.map((c) => c.japanese));
    expect(repairPilotChunks(repair.sentenceId, repair.source, fixed)).toBeNull();
    expect(repairPilotChunks(repair.sentenceId, repair.source + '変更', original)).toBeNull();
    expect(repairPilotChunks(repair.sentenceId, repair.source, original.map((c, i) => i === 1 ? { ...c, notes: 'manual note' } : c))).toBeNull();
  });
});


it('distinguishes unprepared, reviewed, stale and ready question availability', () => {
  const { rerender } = render(<ClausePilotPreview japanese="新しい文章です。" />);
  expect(screen.getByText('Upgraded question not prepared yet')).toBeVisible();
  rerender(<ClausePilotPreview japanese="みなさん、こんにちは。" />);
  expect(screen.getByText('Reviewed — no upgraded question yet')).toBeVisible();
  expect(screen.getByText(/This greeting has no useful/)).toBeVisible();
  rerender(<ClausePilotPreview japanese="みなさん、こんにちは。変更" />);
  expect(screen.getByText('Upgraded question not prepared yet')).toBeVisible();
  rerender(<ClausePilotPreview japanese={CLAUSE_PILOT[0].source} />);
  expect(screen.queryByLabelText('Upgraded question availability')).not.toBeInTheDocument();
  expect(clauseQuestionAvailability(CLAUSE_PILOT[0].source).status).toBe('ready');
  expect(localStorage.length).toBe(0);
});
