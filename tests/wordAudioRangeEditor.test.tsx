import { fireEvent, render, screen } from '@testing-library/react';
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

  it('commits the dragged position, not a stale value prop', () => {
    // The parent deliberately never feeds `onChange` back into `value` here —
    // mimicking the continuous-event `setState` round trip still being
    // in-flight when `pointerup` fires. `endDrag` must still commit where the
    // pointer actually ended up.
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <WordAudioRangeEditor
        blob={blob}
        value={{ startMs: 900, endMs: 1750 }}
        hasOverride
        onChange={onChange}
        onCommit={onCommit}
        onReset={vi.fn()}
      />,
    );

    const svg = screen.getByRole('img', { name: /word audio range editor/i });
    // jsdom gives 0-size rects by default; map clientX 1:1 onto ms (span is
    // max(1, endMs) = 1750 when the clip can't decode).
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1750, height: 88, right: 1750, bottom: 88, x: 0, y: 0 }) as DOMRect;

    const startHandle = screen.getByLabelText('Word start');
    fireEvent.pointerDown(startHandle, { pointerId: 1, clientX: 900 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 400 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 400 });

    expect(onCommit).toHaveBeenCalledWith({ startMs: 400, endMs: 1750 });
  });

  it('drags the handle nearer the pointer even when the two are close together', () => {
    // Regression for card_issue_080e3e2a/8b45266b (2026-09-17): a short word
    // (e.g. まあ) sitting inside a long clip starts with both handles close
    // together. Grabbing near the middle, closer to `start`, must move
    // `start` — dispatching by DOM z-order instead (topmost handle always
    // wins) made `start` ungrabbable and every such drag collapsed the
    // range by dragging `end` on top of it instead.
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <WordAudioRangeEditor
        blob={blob}
        value={{ startMs: 349, endMs: 1000 }}
        hasOverride
        onChange={onChange}
        onCommit={onCommit}
        onReset={vi.fn()}
      />,
    );

    const svg = screen.getByRole('img', { name: /word audio range editor/i });
    // jsdom can't decode the clip, so span falls back to max(1, endMs) =
    // 1000 — map clientX 1:1 onto ms, same as the sibling test above.
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 88, right: 1000, bottom: 88, x: 0, y: 0 }) as DOMRect;

    // Down closer to `start` (349) than `end` (1000) — must drag `start`,
    // widening the range leftward, not collapse it by dragging `end` down.
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 400 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 100 });

    expect(onCommit).toHaveBeenCalledWith({ startMs: 100, endMs: 1000 });
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
