import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { ensureVocabularyItem, getDb } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { KanjiDetailPage } from '../src/pages/KanjiDetailPage';
import { withAppProviders } from '../src/test/providers';

function renderPage(character: string) {
  return render(
    withAppProviders(
      <MemoryRouter initialEntries={[`/kanji/${encodeURIComponent(character)}`]}>
        <Routes>
          <Route path="/kanji/:character" element={<KanjiDetailPage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe('KanjiDetailPage', () => {
  beforeEach(async () => {
    resetDbForTests(`kanji-detail-page-${createId('db')}`);
    await ensureSettings();
  });

  it('shows meanings/readings and the words that use this kanji', async () => {
    await ensureVocabularyItem('大学', 'だいがく', { meaning: 'university' });
    const kanji = await getDb().kanji.where('character').equals('大').first();
    await getDb().kanji.update(kanji!.id, {
      meanings: ['big', 'large'],
      onyomi: ['ダイ'],
      kunyomi: ['おお'],
    });

    renderPage('大');

    expect(await screen.findByText('big, large')).toBeInTheDocument();
    expect(screen.getByText(/On: ダイ/)).toBeInTheDocument();
    expect(screen.getByText(/Kun: おお/)).toBeInTheDocument();
    expect(screen.getByText('大学')).toBeInTheDocument();
    expect(screen.getByText('university')).toBeInTheDocument();
  });

  it('shows an unknown-kanji message when no kanji row exists', async () => {
    renderPage('況');
    expect(await screen.findByText(/unknown kanji/i)).toBeInTheDocument();
  });

  it('lists a word only once even when its kanji repeats within it', async () => {
    await ensureVocabularyItem('民主主義', 'みんしゅしゅぎ', { meaning: 'democracy' });
    renderPage('主');
    await screen.findByText('民主主義');
    expect(screen.getAllByText('民主主義')).toHaveLength(1);
  });
});
