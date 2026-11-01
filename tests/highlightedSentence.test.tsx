import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HighlightedSentence } from '../src/components/ContextWalkthroughView';

const japanese = '言語を学ぶと、文化や生活も学ぶことができます。';
const at = (text: string) => ({ start: japanese.indexOf(text), end: japanese.indexOf(text) + text.length, expression: text });

describe('HighlightedSentence word taps', () => {
  it('keeps the sentence text whole and draws each tappable word as a button, across the highlight', async () => {
    const user = userEvent.setup();
    const onWordTap = vi.fn();
    const { container } = render(
      <HighlightedSentence
        japanese={japanese}
        main={{ start: 0, end: japanese.indexOf('、') + 1 }}
        tappableWords={[at('言語'), at('文化'), at('生活')]}
        onWordTap={onWordTap}
      />,
    );
    expect(container.textContent).toBe(japanese);
    // 言語 sits inside the highlighted span, 文化 outside it.
    await user.click(screen.getByRole('button', { name: 'Check 言語' }));
    await user.click(screen.getByRole('button', { name: 'Check 文化' }));
    expect(onWordTap.mock.calls.map((call) => call[0])).toEqual(['言語', '文化']);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('renders plain text with no buttons when taps are not offered', () => {
    const { container } = render(<HighlightedSentence japanese={japanese} tappableWords={[at('文化')]} />);
    expect(container.textContent).toBe(japanese);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
