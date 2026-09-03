import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WordAudioRangeEditor } from '../src/components/WordAudioRangeEditor';

const blob = new Blob(['clip'], { type: 'audio/mp4' });

describe('WordAudioRangeEditor', () => {
  it('shows the current span and, on an override, a reset control', async () => {
    const onReset = vi.fn();
    render(
      <WordAudioRangeEditor
        blob={blob}
        value={{ startMs: 900, endMs: 1750 }}
        hasOverride
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onReset={onReset}
      />,
    );
    expect(screen.getByRole('img', { name: /word audio range editor/i })).toBeInTheDocument();
    // jsdom has no AudioContext, so decode fails and "Snap to pauses" stays disabled.
    expect(screen.getByRole('button', { name: /snap to pauses/i })).toBeDisabled();

    await userEvent.setup().click(screen.getByRole('button', { name: /reset to auto/i }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('hides the reset control when the span is the automatic guess', () => {
    render(
      <WordAudioRangeEditor
        blob={blob}
        value={{ startMs: 900, endMs: 1750 }}
        hasOverride={false}
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /reset to auto/i })).not.toBeInTheDocument();
  });
});
