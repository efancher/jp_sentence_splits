import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { SessionBar } from '../src/components/SessionBar';
import { ensureSettings, resetDbForTests } from '../src/db/database';
import {
  addMinutesToTodaySession,
  addSentencesToBook,
  createBook,
  getDb,
  getPlannerSession,
} from '../src/db/repository';
import type { PlannerSession } from '../src/domain/types';
import { createId } from '../src/lib/ids';
import { sessionStepTargetPath } from '../src/lib/sessionPlanner';
import { withAppProviders } from '../src/test/providers';

function makeSentence(id: string) {
  const now = new Date().toISOString();
  return {
    id,
    normalizedKey: id,
    japanese: '猫が寝ています。',
    readingOnly: 'ねこがねています。',
    inlineReading: '',
    translation: 'The cat is sleeping.',
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function seedSessionWithTwoVocabSteps(): Promise<PlannerSession> {
  const book = await createBook({ title: 'Continue Me' });
  const db = getDb();
  const sentences = [makeSentence(createId('sent')), makeSentence(createId('sent'))];
  await db.sentences.bulkPut(sentences);
  await addSentencesToBook(
    book.id,
    sentences.map((s) => s.id),
  );
  return addMinutesToTodaySession(30);
}

function renderBarAt(path: string) {
  return render(
    withAppProviders(
      <MemoryRouter initialEntries={[path]}>
        <SessionBar />
      </MemoryRouter>,
    ),
  );
}

describe('SessionBar', () => {
  beforeEach(async () => {
    resetDbForTests(`session-bar-${createId('db')}`);
    await ensureSettings();
  });

  it('on a pending step\'s own page, names that step and "Mark complete" settles exactly it', async () => {
    const session = await seedSessionWithTwoVocabSteps();
    const [first, second] = session.steps.filter((s) => s.targetKind === 'vocabulary_review');

    renderBarAt(sessionStepTargetPath(first!)!);

    expect(await screen.findByText(first!.label)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Mark complete' }));

    await waitFor(async () => {
      const updated = await getPlannerSession(session.id);
      expect(updated!.steps.find((s) => s.id === first!.id)!.status).toBe('completed');
      expect(updated!.steps.find((s) => s.id === second!.id)!.status).toBe('active');
    });
  });

  it('on an unrelated page, offers "Resume" (navigate only) instead of "Mark complete"', async () => {
    const session = await seedSessionWithTwoVocabSteps();
    const [first] = session.steps.filter((s) => s.targetKind === 'vocabulary_review');

    renderBarAt('/books');

    expect(await screen.findByText(`Next: ${first!.label}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark complete' })).not.toBeInTheDocument();

    // Nothing was settled just by rendering the bar somewhere else.
    const updated = await getPlannerSession(session.id);
    expect(updated!.steps.every((s) => s.status === 'pending' || s.status === 'active')).toBe(true);
  });
});
