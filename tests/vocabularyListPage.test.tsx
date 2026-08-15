import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { ensureVocabularyItem } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { VocabularyListPage } from '../src/pages/VocabularyListPage';
import { withAppProviders } from '../src/test/providers';

function renderPage() {
  return render(
    withAppProviders(
      <MemoryRouter initialEntries={['/vocabulary']}>
        <Routes>
          <Route path="/vocabulary" element={<VocabularyListPage />} />
          <Route path="/kanji/:character" element={<div>kanji detail</div>} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe('VocabularyListPage', () => {
  beforeEach(async () => {
    resetDbForTests(`vocab-list-page-${createId('db')}`);
    await ensureSettings();
  });

  it('shows an empty state with no confirmed vocabulary', async () => {
    renderPage();
    expect(
      await screen.findByText(/no confirmed vocabulary yet/i),
    ).toBeInTheDocument();
  });

  it('lists vocabulary items with expression, reading, and meaning', async () => {
    await ensureVocabularyItem('大学', 'だいがく', { meaning: 'university' });
    renderPage();
    expect(await screen.findByText('だいがく')).toBeInTheDocument();
    expect(screen.getByText('university')).toBeInTheDocument();
  });

  it('filters by search query', async () => {
    await ensureVocabularyItem('大学', 'だいがく', { meaning: 'university' });
    await ensureVocabularyItem('猫', 'ねこ', { meaning: 'cat' });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('university');

    await user.type(screen.getByLabelText(/search vocabulary/i), 'cat');
    expect(screen.getByText('cat')).toBeInTheDocument();
    expect(screen.queryByText('university')).not.toBeInTheDocument();
  });

  it('renders each kanji character as a link to its detail page', async () => {
    await ensureVocabularyItem('大学', 'だいがく');
    renderPage();
    const link = await screen.findByRole('link', { name: '大' });
    expect(link).toHaveAttribute('href', expect.stringContaining('/kanji/'));
  });
});
