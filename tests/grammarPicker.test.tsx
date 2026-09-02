import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import {
  confirmSentenceVocabulary,
  ensureGrammarPattern,
  ensureSentenceGrammar,
  getDb,
} from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { GrammarPicker } from '../src/components/GrammarPicker';
import { withAppProviders } from '../src/test/providers';

function renderPicker(sentenceId = 'sent-1', japanese = 'そんなこと言うわけないでしょ。') {
  return render(
    withAppProviders(
      <MemoryRouter>
        <GrammarPicker sentenceId={sentenceId} japanese={japanese} />
      </MemoryRouter>,
    ),
  );
}

describe('GrammarPicker', () => {
  beforeEach(async () => {
    resetDbForTests(`grammar-picker-${createId('db')}`);
    await ensureSettings();
  });

  it('shows an empty state with nothing tagged yet', async () => {
    renderPicker();
    expect(
      await screen.findByText(/no grammar patterns tagged/i),
    ).toBeInTheDocument();
  });

  it('adding a new name creates a pattern and links it to the sentence', async () => {
    const user = userEvent.setup();
    renderPicker('sent-1');

    await user.type(
      screen.getByLabelText('Grammar pattern name'),
      '〜わけがない',
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('〜わけがない')).toBeInTheDocument();
    const pattern = await getDb()
      .grammarPatterns.where('canonicalName')
      .equals('〜わけがない')
      .first();
    expect(pattern).toBeTruthy();
    expect(pattern?.provenance).toBe('manual');
    const links = await getDb()
      .sentenceGrammar.where('sentenceId')
      .equals('sent-1')
      .toArray();
    expect(links).toHaveLength(1);
    expect(links[0]?.grammarPatternId).toBe(pattern?.id);
    expect(links[0]?.confirmedByLearner).toBe(false);
  });

  it('adding an already-existing name reuses the pattern instead of duplicating it', async () => {
    await ensureGrammarPattern('〜わけがない');
    const user = userEvent.setup();
    renderPicker('sent-1');

    await user.type(
      screen.getByLabelText('Grammar pattern name'),
      '〜わけがない',
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await screen.findByText('〜わけがない');
    expect(await getDb().grammarPatterns.count()).toBe(1);
  });

  it('"Got it" confirms the occurrence without creating a study item', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    await ensureSentenceGrammar('sent-1', pattern.id, {});
    const user = userEvent.setup();
    renderPicker('sent-1');

    await user.click(await screen.findByRole('button', { name: 'Got it' }));

    await screen.findByText('Confirmed');
    expect(
      await getDb().studyItems.where('subjectId').equals(pattern.id).count(),
    ).toBe(0);
  });

  it('Track is disabled until the sentence\'s own vocabulary is confirmed + proficient', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    await ensureSentenceGrammar('sent-1', pattern.id, {});
    renderPicker('sent-1');

    expect(await screen.findByRole('button', { name: 'Track' })).toBeDisabled();
    expect(await screen.findByText(/Track becomes available once/i)).toBeInTheDocument();
  });

  it('"Track" confirms the occurrence and creates both starting grammarPattern study items', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    await ensureSentenceGrammar('sent-1', pattern.id, {});
    await confirmSentenceVocabulary('sent-1', []); // sentence vocab ready → Track enabled
    const user = userEvent.setup();
    renderPicker('sent-1');

    await user.click(await screen.findByRole('button', { name: 'Track' }));

    await screen.findByText('Confirmed');
    await screen.findByText('Tracked');
    // onTrack fires its two ensureGrammarStudyItem writes as a detached
    // async chain (not awaited by the click event itself), and "Tracked"
    // renders as soon as the *first* one lands — so this needs its own
    // wait rather than assuming both are done the instant "Tracked" shows.
    const studyItems = await waitFor(async () => {
      const items = await getDb().studyItems.where('subjectId').equals(pattern.id).toArray();
      expect(items).toHaveLength(2);
      return items;
    });
    expect(studyItems.every((item) => item.subjectType === 'grammarPattern')).toBe(true);
    expect(studyItems.map((item) => item.activityType).sort()).toEqual([
      'grammar_completion',
      'grammar_comprehension',
    ]);
  });

  it('"Explain" expands the form and Save persists edits to the pattern and the occurrence', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    const link = await ensureSentenceGrammar('sent-1', pattern.id, {});
    const user = userEvent.setup();
    renderPicker('sent-1');

    await user.click(await screen.findByRole('button', { name: 'Explain' }));
    const meaningInput = await screen.findByLabelText(
      'Short meaning / communicative function',
    );
    await user.type(meaningInput, "there's no way...");
    const occurrenceInput = screen.getByLabelText(
      'Why this fits this sentence (optional)',
    );
    await user.type(occurrenceInput, 'Speaker rejects the proposition outright.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await Promise.resolve();
    const updated = await getDb().grammarPatterns.get(pattern.id);
    const updatedLink = await getDb().sentenceGrammar.get(link.id);
    expect(updated?.shortMeaning).toBe("there's no way...");
    expect(updatedLink?.occurrenceExplanation).toBe(
      'Speaker rejects the proposition outright.',
    );
  });

  it('"Done — nothing more to notice" marks the sentence grammar-reviewed and can be reopened', async () => {
    const user = userEvent.setup();
    renderPicker('sent-1');

    await user.click(await screen.findByRole('button', { name: /Done — nothing more to notice/ }));

    await screen.findByText('Reviewed');
    expect((await getDb().analyses.get('sent-1'))?.grammarReviewStatus).toBe('confirmed');

    await user.click(await screen.findByRole('button', { name: 'Reopen grammar' }));
    await waitFor(async () => {
      expect((await getDb().analyses.get('sent-1'))?.grammarReviewStatus).toBe('unreviewed');
    });
  });

  it('"Remove" unlinks the pattern from the sentence, returning to the empty state', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    await ensureSentenceGrammar('sent-1', pattern.id, {});
    const user = userEvent.setup();
    renderPicker('sent-1');

    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(
      await screen.findByText(/no grammar patterns tagged/i),
    ).toBeInTheDocument();
    expect(await getDb().grammarPatterns.get(pattern.id)).toBeTruthy();
  });
});
