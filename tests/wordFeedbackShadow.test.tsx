import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WordFeedbackPanel } from '../src/components/ReaderTools';

const word = { vocabularyItemId: 'v1', surface: '寝て', expression: '寝る', reading: 'ねる', meaning: 'to sleep' };

function renderPanel(onShadowPhrase?: () => void) {
  return render(
    <WordFeedbackPanel
      word={word}
      readingHidden
      meaningHidden
      onRecord={() => {}}
      onShadowPhrase={onShadowPhrase}
      onClose={() => {}}
    />,
  );
}

describe('WordFeedbackPanel "Shadow this phrase"', () => {
  it('is offered only after the learner says they did not know the reading', async () => {
    const user = userEvent.setup();
    const onShadowPhrase = vi.fn();
    renderPanel(onShadowPhrase);
    expect(screen.queryByRole('button', { name: 'Shadow this phrase' })).toBeNull();

    const [readingDidnt] = screen.getAllByRole('button', { name: 'I didn’t' });
    await user.click(readingDidnt!);
    await user.click(screen.getByRole('button', { name: 'Shadow this phrase' }));
    expect(onShadowPhrase).toHaveBeenCalledTimes(1);
  });

  it('is not offered when they knew the reading, only gave a meaning answer, or the sentence cannot shadow', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPanel(() => {});
    const [readingKnew] = screen.getAllByRole('button', { name: 'I knew it' });
    await user.click(readingKnew!);
    expect(screen.queryByRole('button', { name: 'Shadow this phrase' })).toBeNull();
    unmount();

    renderPanel(() => {});
    const didnts = screen.getAllByRole('button', { name: 'I didn’t' });
    await user.click(didnts[1]!); // the meaning row
    expect(screen.queryByRole('button', { name: 'Shadow this phrase' })).toBeNull();
    // eslint-disable-next-line testing-library/no-node-access
    document.body.innerHTML = '';

    renderPanel(undefined);
    await user.click(screen.getAllByRole('button', { name: 'I didn’t' })[0]!);
    expect(screen.queryByRole('button', { name: 'Shadow this phrase' })).toBeNull();
  });
});
