import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ReadingCheckLine, ReadingCheckPanel } from '../src/components/ReaderTools';
import type { TileDictation } from '../src/lib/earTiles';

const tile: TileDictation = { text: '趣味が', reading: 'シュミガ', before: '私は', after: '多いです。' };

function renderPanel(onRecord = vi.fn()) {
  render(<ReadingCheckPanel tile={tile} surface="趣味" hasAudio={false} playing={false} onPlay={() => {}} onRecord={onRecord} onClose={() => {}} />);
  return onRecord;
}

describe('Reading check', () => {
  it('marks the phrase in the plain sentence', () => {
    render(<ReadingCheckLine tile={tile} />);
    expect(screen.getByTestId('reading-check-phrase').textContent).toBe('趣味が');
  });

  it('grades a typed romaji reading as feedback only, then records the learner’s own call', async () => {
    const user = userEvent.setup();
    const onRecord = renderPanel();
    await user.type(screen.getByLabelText('Reading'), 'shumiga');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByText('✓ Matches')).toBeTruthy();
    // A match decides nothing: no outcome is recorded until the learner chooses.
    expect(onRecord).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Needed help' }));
    expect(onRecord).toHaveBeenCalledExactlyOnceWith('needed_help');
  });

  it('does not accept the kanji as the reading, and offers to just show it', async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(screen.getByRole('button', { name: "Can't read it" })).toBeTruthy();
    await user.type(screen.getByLabelText('Reading'), '趣味が');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByText('✗ Not quite')).toBeTruthy();
    expect(screen.getByText('シュミガ')).toBeTruthy();
  });
});
