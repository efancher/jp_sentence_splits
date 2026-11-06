import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { getDb, resetDbForTests } from '../src/db/database';
import { listChunkIssueReports, reportChunkIssues } from '../src/db/repository';
import type { Sentence } from '../src/domain/types';
import { createId } from '../src/lib/ids';
import { CardIssuesPage } from '../src/pages/CardIssuesPage';
import { withAppProviders } from '../src/test/providers';

function renderPage() {
  return render(
    withAppProviders(
      <MemoryRouter>
        <CardIssuesPage />
      </MemoryRouter>,
    ),
  );
}

describe('CardIssuesPage reading checks', () => {
  beforeEach(() => {
    resetDbForTests(`issues-reading-${createId('db')}`);
  });

  it('shows each open reading flag on its sentence card and applies the chosen reading', async () => {
    const sentenceId = createId('sent');
    await getDb().sentences.put({
      id: sentenceId,
      japanese: 'その他にも',
      inlineReading: 'その他[た]にも',
      readingOnly: 'そのたにも',
    } as Sentence);
    await reportChunkIssues('meaning_checks', [
      { sentenceId, chunks: [], note: 'Reading check — 他: furigana た, assistant ほか' },
    ]);

    renderPage();
    expect(await screen.findByText(/Reading checks \(1\)/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Use ほか' }));

    await waitFor(async () => {
      expect((await getDb().sentences.get(sentenceId))?.inlineReading).toBe('その他[ほか]にも');
    });
    expect((await listChunkIssueReports())[0]!.status).toBe('resolved');
  });

  it('keeps non-reading authoring issues in the grouped section', async () => {
    await reportChunkIssues('particle_checks', [
      { sentenceId: 's1', chunks: ['に', 'なる'], note: 'に | なる → になる (x)' },
    ]);
    renderPage();
    expect(await screen.findByText('Authoring issues (chunks & meanings)')).toBeInTheDocument();
    expect(screen.queryByText(/Reading checks/)).not.toBeInTheDocument();
  });
});
