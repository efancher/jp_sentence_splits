import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import App from '../src/App';
import { ensureSettings, resetDbForTests } from '../src/db/database';
import { createId } from '../src/lib/ids';

const littleBirds = readFileSync(
  resolve(import.meta.dirname, '../fixtures/little-birds.csv'),
  'utf8',
);

function fileFromCsv(name: string, contents: string): File {
  return new File([contents], name, { type: 'text/csv' });
}

describe('UI flows', () => {
  beforeEach(async () => {
    resetDbForTests(`ui-${createId('db')}`);
    await ensureSettings();
    window.history.replaceState({}, '', '/#/');
  });

  it('imports a fixture, creates a book, edits analysis, and autosaves', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('link', { name: 'Import' }));
    const input = await screen.findByLabelText(/CSV file/i);
    await user.upload(input, fileFromCsv('little-birds.csv', littleBirds));

    await screen.findByText(/Import preview/i);
    expect(screen.getByText(/Unique sentences:/i)).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText(/Place selected sentences/i),
      'new_book',
    );
    await user.click(screen.getByRole('button', { name: /Import .* selected/i }));

    await screen.findByRole('heading', { name: /little-birds/i });
    const analyzeButtons = await screen.findAllByRole('button', {
      name: 'Analyze',
    });
    await user.click(analyzeButtons[0]!);

    const chunkBox = await screen.findByLabelText(/Chunk spaced Japanese/i);
    fireEvent.change(chunkBox, {
      target: { value: 'ある小鳥の 夫婦が、 木に 巣を 作りました。' },
    });
    fireEvent.blur(chunkBox);

    const roleInputs = await screen.findAllByLabelText('Role');
    fireEvent.change(roleInputs[0]!, { target: { value: 'modifier/content' } });
    fireEvent.blur(roleInputs[0]!);

    const litInputs = await screen.findAllByLabelText(/Literal sticky English/i);
    fireEvent.change(litInputs[0]!, {
      target: { value: "a-certain-little-bird's" },
    });
    fireEvent.blur(litInputs[0]!);

    await waitFor(() => {
      expect(screen.getByText(/Saved|Saving/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => {
      expect(screen.getByDisplayValue('modifier/content')).toBeInTheDocument();
      expect(
        screen.getByDisplayValue("a-certain-little-bird's"),
      ).toBeInTheDocument();
    });
  }, 30000);

  it('reorders with explicit buttons and reveals practice stages', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Import' }));
    await user.upload(
      await screen.findByLabelText(/CSV file/i),
      fileFromCsv('little-birds.csv', littleBirds),
    );
    await screen.findByText(/Import preview/i);
    await user.selectOptions(
      screen.getByLabelText(/Place selected sentences/i),
      'new_book',
    );
    await user.click(screen.getByRole('button', { name: /Import .* selected/i }));
    await screen.findByRole('button', { name: 'Edit order' });
    await user.click(screen.getByRole('button', { name: 'Edit order' }));

    const firstMoveDown = screen.getAllByRole('button', { name: 'Down' })[0]!;
    const before = screen.getAllByText(/#\d/)[0]?.textContent;
    await user.click(firstMoveDown);
    await waitFor(() => {
      expect(screen.getByText(/Order updated/i)).toBeInTheDocument();
    });
    expect(before).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Done ordering' }));
    await user.click(screen.getByRole('button', { name: 'Practice' }));
    expect(
      await screen.findByText(/CHUNK: \(hidden\)/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Practice scope')).toHaveValue('incomplete');
    await user.click(screen.getByRole('button', { name: 'Reveal chunks' }));
    await user.click(screen.getByRole('button', { name: 'Reveal roles' }));
    await waitFor(() => {
      expect(screen.queryByText(/CHUNK: \(hidden\)/)).not.toBeInTheDocument();
    });
    const summaries = screen.getAllByText(/CHUNK:/);
    const practiceSummary = summaries
      .map((node) => node.closest('.summary-lines'))
      .find((node) => node?.textContent?.includes('ROLE:'));
    expect(practiceSummary).toBeTruthy();
    expect(within(practiceSummary!).getByText(/ROLE:/)).toBeInTheDocument();
    await user.click(screen.getByLabelText('Shuffle session'));
    expect(screen.getByLabelText('Shuffle session')).toBeChecked();
  }, 30000);

  it('assigns selected Inbox sentences to a newly created book', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Import' }));
    await user.upload(
      await screen.findByLabelText(/CSV file/i),
      fileFromCsv('little-birds.csv', littleBirds),
    );
    await screen.findByText(/Import preview/i);
    await user.click(screen.getByRole('button', { name: /Import .* selected/i }));

    await screen.findByRole('heading', { name: 'Inbox' });
    const sentenceCheckboxes = await screen.findAllByLabelText('Select sentence');
    await user.click(sentenceCheckboxes[0]!);
    await user.selectOptions(
      screen.getByLabelText('Destination book'),
      'new',
    );
    await user.type(screen.getByLabelText('New book title'), 'Inbox Book');
    await user.click(screen.getByRole('button', { name: 'Add to book' }));

    await screen.findByText('Added 1 sentence(s) to a book.');
    await user.click(screen.getByRole('link', { name: 'Books' }));
    expect(
      await screen.findByText('Inbox Book', { selector: 'strong' }),
    ).toBeInTheDocument();
  }, 30000);

  it('opens an import batch and performs a bulk Search action', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Import' }));
    await user.upload(
      await screen.findByLabelText(/CSV file/i),
      fileFromCsv('little-birds.csv', littleBirds),
    );
    await screen.findByText(/Import preview/i);
    await user.click(screen.getByRole('button', { name: /Import .* selected/i }));

    await screen.findByRole('heading', { name: 'Inbox' });
    await user.click(
      await screen.findByRole('button', { name: 'View batch' }),
    );
    expect(
      await screen.findByRole('heading', { name: /little-birds/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Sentences in this batch')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Search' }));
    const search = await screen.findByLabelText('Search');
    await user.type(search, '小鳥');
    await user.click(await screen.findByLabelText('Select result'));
    await user.selectOptions(screen.getByLabelText('Add to book'), 'new');
    await user.type(screen.getByLabelText('New book title'), 'Search Book');
    await user.click(screen.getByRole('button', { name: 'Add selected' }));
    expect(
      await screen.findByText('Added 1 result(s) to a book.'),
    ).toBeInTheDocument();
  }, 30000);
});
