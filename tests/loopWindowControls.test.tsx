import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LoopWindowControls } from '../src/components/LoopWindowControls';

function setup(range = { startMs: 1000, endMs: 2000 }, gapMs = 0) {
  const onRangeChange = vi.fn();
  const onGapChange = vi.fn();
  const onReset = vi.fn();
  render(
    <LoopWindowControls
      durationMs={4000}
      range={range}
      gapMs={gapMs}
      onRangeChange={onRangeChange}
      onGapChange={onGapChange}
      onReset={onReset}
    />,
  );
  return { onRangeChange, onGapChange, onReset };
}

describe('LoopWindowControls', () => {
  it('moves the start and end handles, and stops them crossing', () => {
    const { onRangeChange } = setup();
    fireEvent.change(screen.getByLabelText('Loop start'), { target: { value: '500' } });
    expect(onRangeChange).toHaveBeenLastCalledWith({ startMs: 500, endMs: 2000 });
    fireEvent.change(screen.getByLabelText('Loop start'), { target: { value: '3000' } });
    expect(onRangeChange).toHaveBeenLastCalledWith({ startMs: 1800, endMs: 2000 });
    fireEvent.change(screen.getByLabelText('Loop end'), { target: { value: '1100' } });
    expect(onRangeChange).toHaveBeenLastCalledWith({ startMs: 1000, endMs: 1200 });
  });

  it('reports the pause and offers a reset only when a window is set', () => {
    const { onGapChange, onReset } = setup({ startMs: 1000, endMs: 2000 }, 500);
    fireEvent.change(screen.getByLabelText('Pause between loops'), { target: { value: '1200' } });
    expect(onGapChange).toHaveBeenLastCalledWith(1200);
    fireEvent.click(screen.getByRole('button', { name: 'Whole sentence' }));
    expect(onReset).toHaveBeenCalled();
  });

  it('hides the reset when the window is the whole clip', () => {
    setup({ startMs: 0, endMs: 4000 });
    expect(screen.queryByRole('button', { name: 'Whole sentence' })).toBeNull();
  });
});
