import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DrillTakeLabelsPanel } from '../src/components/DrillTakeLabels';

describe('DrillTakeLabelsPanel', () => {
  it('renders nothing without words', () => {
    const { container } = render(<DrillTakeLabelsPanel words={[]} labels={{}} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('sets a verdict per word and toggles it off on a second tap', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<DrillTakeLabelsPanel words={['友達', '雨']} labels={{}} onChange={onChange} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Felt off' })[1]!);
    expect(onChange).toHaveBeenLastCalledWith('雨', 'off');

    rerender(<DrillTakeLabelsPanel words={['友達', '雨']} labels={{ 雨: 'off' }} onChange={onChange} />);
    const pressed = screen.getAllByRole('button', { name: 'Felt off' })[1]!;
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(pressed);
    expect(onChange).toHaveBeenLastCalledWith('雨', null);
  });
});
