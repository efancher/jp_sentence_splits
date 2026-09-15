import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import {
  ensureGrammarPattern,
  ensureGrammarStudyItem,
  ensureSentenceGrammar,
  removeSentenceGrammar,
} from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { GrammarListPage } from '../src/pages/GrammarListPage';
import { withAppProviders } from '../src/test/providers';

function renderPage() {
  return render(
    withAppProviders(
      <MemoryRouter initialEntries={['/grammar']}>
        <Routes>
          <Route path="/grammar" element={<GrammarListPage />} />
          <Route path="/grammar/:patternId" element={<div>detail</div>} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe('GrammarListPage', () => {
  beforeEach(async () => {
    resetDbForTests(`grammar-list-page-${createId('db')}`);
    await ensureSettings();
  });

  it('shows an empty state with no tagged patterns', async () => {
    renderPage();
    expect(
      await screen.findByText(/no grammar patterns tagged yet/i),
    ).toBeInTheDocument();
  });

  it('lists patterns with encounter count and links to the detail page', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない', {
      shortMeaning: "there's no way...",
    });
    await ensureSentenceGrammar('sent-1', pattern.id, {});
    await ensureSentenceGrammar('sent-2', pattern.id, {});

    renderPage();

    expect(await screen.findByText('〜わけがない')).toBeInTheDocument();
    expect(screen.getByText("there's no way...")).toBeInTheDocument();
    expect(screen.getByText(/Encountered 2 times/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /わけがない/ });
    expect(link).toHaveAttribute('href', expect.stringContaining(`/grammar/${pattern.id}`));
  });

  it('shows a Tracked badge for patterns with a study item', async () => {
    const pattern = await ensureGrammarPattern('〜わけがない');
    await ensureSentenceGrammar('sent-1', pattern.id, {});
    await ensureGrammarStudyItem(pattern.id, 'grammar_comprehension');

    renderPage();

    await screen.findByText('〜わけがない');
    expect(screen.getByText('Tracked')).toBeInTheDocument();
  });

  it('groups patterns into priority-bucket sections', async () => {
    const worthLearning = await ensureGrammarPattern('〜わけがない');
    await ensureSentenceGrammar('sent-1', worthLearning.id, {});
    await ensureSentenceGrammar('sent-2', worthLearning.id, {});
    await ensureSentenceGrammar('sent-3', worthLearning.id, {});
    const developing = await ensureGrammarPattern('〜てしまう');
    await ensureSentenceGrammar('sent-4', developing.id, {});
    await ensureGrammarStudyItem(developing.id, 'grammar_comprehension');

    renderPage();

    await screen.findByText('〜わけがない');
    expect(screen.getByText('Worth learning now')).toBeInTheDocument();
    expect(screen.getByText('Developing')).toBeInTheDocument();
  });

  it('hides an orphaned pattern whose sentence links were all removed', async () => {
    const orphan = await ensureGrammarPattern('それより', {
      shortMeaning: 'shifting focus to a different topic',
    });
    const link = await ensureSentenceGrammar('sent-1', orphan.id, {});
    const live = await ensureGrammarPattern('〜てしまう');
    await ensureSentenceGrammar('sent-2', live.id, {});

    await removeSentenceGrammar(link.id);

    renderPage();

    await screen.findByText('〜てしまう');
    expect(screen.queryByText('それより')).not.toBeInTheDocument();
  });

  it('keeps a tracked pattern even with zero live encounters', async () => {
    const pattern = await ensureGrammarPattern('〜じゃん');
    const link = await ensureSentenceGrammar('sent-1', pattern.id, {});
    await ensureGrammarStudyItem(pattern.id, 'grammar_comprehension');
    await removeSentenceGrammar(link.id);

    renderPage();

    expect(await screen.findByText('〜じゃん')).toBeInTheDocument();
  });

  it('filters by search query against name, meaning, and family', async () => {
    const wakega = await ensureGrammarPattern('〜わけがない', {
      shortMeaning: "there's no way...",
      family: 'expectation/inference',
    });
    await ensureSentenceGrammar('sent-1', wakega.id, {});
    const teshimau = await ensureGrammarPattern('〜てしまう', {
      shortMeaning: 'completion, often regrettable',
    });
    await ensureSentenceGrammar('sent-2', teshimau.id, {});
    const user = userEvent.setup();

    renderPage();
    await screen.findByText('〜わけがない');

    await user.type(screen.getByLabelText(/search grammar patterns/i), 'regrettable');
    expect(screen.getByText('〜てしまう')).toBeInTheDocument();
    expect(screen.queryByText('〜わけがない')).not.toBeInTheDocument();
  });
});
