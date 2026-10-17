import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CLAUSE_PILOT } from '../src/data/clausePilot';
import { ClausePilotPreview } from '../src/components/ClausePilotPreview';
import { resetDbForTests } from '../src/db/database';
import { getDb, latestClauseQuestionFeedback, logClauseQuestionFeedback } from '../src/db/repository';
import { clausePilotFeedbackKey } from '../src/lib/clausePilot';
import { createId } from '../src/lib/ids';
import { clauseQuestionFeedbackToRemote, remoteToClauseQuestionFeedback } from '../src/sync/mappers';

const reference = CLAUSE_PILOT[0]!;

async function openAndReveal(container: HTMLElement) {
  const details = container.querySelector('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  await screen.findByLabelText('Sentence with the target highlighted');
  fireEvent.click(screen.getByRole('button', { name: 'Show explanation' }));
}

describe('clause question feedback', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDbForTests(`clause-feedback-${createId('db')}`);
  });

  it('round-trips through the remote row mapping', () => {
    const feedback = {
      id: 'clausefb_1',
      timestamp: '2026-10-17T00:00:00.000Z',
      sentenceId: 's1',
      referenceId: reference.id,
      value: 'disputed' as const,
      chosenOption: reference.options[1],
      draftAnswer: reference.answerText,
    };
    const remote = clauseQuestionFeedbackToRemote(feedback, 'owner', 1);
    expect(remote).toMatchObject({ owner_id: 'owner', sentence_id: 's1', reference_id: reference.id, value: 'disputed', chosen_option: reference.options[1] });
    expect(remoteToClauseQuestionFeedback(remote)).toEqual(feedback);
    expect(remoteToClauseQuestionFeedback({ ...remote, chosen_option: null }).chosenOption).toBeUndefined();
  });

  it('keeps every reaction and reports the latest as current', async () => {
    const base = { sentenceId: 's1', referenceId: reference.id, draftAnswer: reference.answerText };
    await logClauseQuestionFeedback({ ...base, value: 'helpful', timestamp: '2026-10-17T00:00:00.000Z' });
    await logClauseQuestionFeedback({ ...base, value: 'disputed', timestamp: '2026-10-17T00:01:00.000Z' });
    expect(await getDb().clauseQuestionFeedback.count()).toBe(2);
    expect((await latestClauseQuestionFeedback(reference.id))?.value).toBe('disputed');
    expect(await latestClauseQuestionFeedback('other-question')).toBeUndefined();
  });

  it('records a synced row (with the chosen option) when the learner reacts', async () => {
    const { container } = render(<ClausePilotPreview japanese={reference.source} sentenceId="sentence_1" />);
    await openAndReveal(container);
    fireEvent.click(screen.getByRole('button', { name: reference.options[1]!, exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Another answer works' }));
    await waitFor(async () => expect(await getDb().clauseQuestionFeedback.count()).toBe(1));
    const [row] = await getDb().clauseQuestionFeedback.toArray();
    expect(row).toMatchObject({ sentenceId: 'sentence_1', referenceId: reference.id, value: 'disputed', draftAnswer: reference.answerText });
  });

  it('imports a reaction saved before syncing existed, once', async () => {
    localStorage.setItem(clausePilotFeedbackKey(reference.id), 'helpful');
    const first = render(<ClausePilotPreview japanese={reference.source} sentenceId="sentence_1" />);
    await waitFor(async () => expect(await getDb().clauseQuestionFeedback.count()).toBe(1));
    first.unmount();
    render(<ClausePilotPreview japanese={reference.source} sentenceId="sentence_1" />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await getDb().clauseQuestionFeedback.count()).toBe(1);
    const imported = await latestClauseQuestionFeedback(reference.id);
    expect(imported?.value).toBe('helpful');
    expect(imported?.chosenOption).toBeUndefined();
  });

  it('does not write anything without a sentence id', async () => {
    const { container } = render(<ClausePilotPreview japanese={reference.source} />);
    await openAndReveal(container);
    fireEvent.click(screen.getByRole('button', { name: 'This explanation helped' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await getDb().clauseQuestionFeedback.count()).toBe(0);
  });
});
