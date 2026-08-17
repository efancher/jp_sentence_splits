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
    expect(
      await screen.findByLabelText('Meaning for 大学'),
    ).toHaveValue('university');
  });

  it('filters by search query', async () => {
    await ensureVocabularyItem('大学', 'だいがく', { meaning: 'university' });
    await ensureVocabularyItem('猫', 'ねこ', { meaning: 'cat' });
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText('Meaning for 大学');

    await user.type(screen.getByLabelText(/search vocabulary/i), 'cat');
    expect(screen.getByLabelText('Meaning for 猫')).toHaveValue('cat');
    expect(screen.queryByLabelText('Meaning for 大学')).not.toBeInTheDocument();
  });

  it('lets the user edit a vocabulary item meaning inline', async () => {
    const item = await ensureVocabularyItem('猫', 'ねこ');
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByLabelText('Meaning for 猫');
    await user.type(input, 'cat');
    await user.tab();

    await screen.findByText('Saved');
    const { getDb } = await import('../src/db/repository');
    const updated = await getDb().vocabularyItems.get(item.id);
    expect(updated?.meaning).toBe('cat');
  });

  it('renders each kanji character as a link to its detail page', async () => {
    await ensureVocabularyItem('大学', 'だいがく');
    renderPage();
    const link = await screen.findByRole('link', { name: '大' });
    expect(link).toHaveAttribute('href', expect.stringContaining('/kanji/'));
  });
});
