import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SegmentationEditor } from '../src/components/SegmentationEditor';
import type { ResegmentReviewRow } from '../src/lib/resegmentPlan';

const row = (over: Partial<ResegmentReviewRow> = {}): ResegmentReviewRow => ({
  japanese: 'ねこ。',
  translation: 'Cat.',
  readingOnly: '',
  inlineReading: '',
  tokens: [],
  sourceIndexes: [0],
  startMs: 0,
  endMs: 1000,
  sourceTranslations: ['Cat.'],
  needsTranslationReview: false,
  ...over,
});

describe('SegmentationEditor', () => {
  it('renders one editable section per row', () => {
    render(
      <SegmentationEditor
        rows={[row({ japanese: 'ねこ。' }), row({ japanese: 'いぬ。' })]}
        onRowsChange={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('ねこ。')).toBeInTheDocument();
    expect(screen.getByDisplayValue('いぬ。')).toBeInTheDocument();
  });

  it('merges a row up through onRowsChange', async () => {
    const onRowsChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SegmentationEditor
        rows={[row({ japanese: 'ねこ。' }), row({ japanese: 'いぬ。' })]}
        onRowsChange={onRowsChange}
      />,
    );
    const second = screen.getByDisplayValue('いぬ。').closest('section')!;
    await user.click(within(second).getByRole('button', { name: 'Merge up' }));
    expect(onRowsChange).toHaveBeenCalledWith([
      expect.objectContaining({ japanese: 'ねこ。いぬ。', needsTranslationReview: true }),
    ]);
  });

  it('splits a row on internal punctuation', async () => {
    const onRowsChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SegmentationEditor
        rows={[row({ japanese: 'ねこ。いぬ。', translation: 'Cat. Dog.' })]}
        onRowsChange={onRowsChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Split by 。' }));
    expect(onRowsChange).toHaveBeenCalledWith([
      expect.objectContaining({ japanese: 'ねこ。' }),
      expect.objectContaining({ japanese: 'いぬ。' }),
    ]);
  });

  it('clears the translation-review flag on a translation edit', async () => {
    const onRowsChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SegmentationEditor
        rows={[row({ translation: '', needsTranslationReview: true })]}
        onRowsChange={onRowsChange}
      />,
    );
    await user.type(screen.getByRole('textbox', { name: 'Translation' }), 'C');
    expect(onRowsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ translation: 'C', needsTranslationReview: false }),
    ]);
  });

  it('collapses rows without study progress until asked to show all', () => {
    const rows = [
      row({ japanese: 'ねこ。' }),
      row({ japanese: 'いぬ。' }),
      row({ japanese: 'とり。' }),
    ];
    const { rerender } = render(
      <SegmentationEditor
        rows={rows}
        onRowsChange={vi.fn()}
        rowsWithProgress={new Set([1])}
      />,
    );
    // Only the progress row is a full textarea; the other two collapse.
    expect(screen.getByDisplayValue('いぬ。')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('ねこ。')).not.toBeInTheDocument();
    expect(screen.getByText(/2 other sentences/)).toBeInTheDocument();

    rerender(
      <SegmentationEditor
        rows={rows}
        onRowsChange={vi.fn()}
        rowsWithProgress={new Set([1])}
        showAllRows
      />,
    );
    expect(screen.getByDisplayValue('ねこ。')).toBeInTheDocument();
    expect(screen.getByDisplayValue('とり。')).toBeInTheDocument();
  });

  it('renders the boundary waveform when given a waveform fetcher', async () => {
    const waveformForRange = vi.fn(async () => ({
      peaks: [{ min: -0.5, max: 0.5 }],
      silenceMidsMs: [1000],
    }));
    render(
      <SegmentationEditor
        rows={[row({ startMs: 0, endMs: 1000 }), row({ startMs: 1000, endMs: 2000 })]}
        onRowsChange={vi.fn()}
        waveformForRange={waveformForRange}
      />,
    );
    expect(await screen.findByRole('img', { name: /span waveform/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /snap to pauses/i })).toBeInTheDocument();
    expect(waveformForRange).toHaveBeenCalledWith(0, 2000);
  });

  it('has no waveform without a waveform fetcher', () => {
    render(<SegmentationEditor rows={[row()]} onRowsChange={vi.fn()} />);
    expect(screen.queryByRole('img', { name: /span waveform/i })).not.toBeInTheDocument();
  });

  it('freezes every control when disabled', () => {
    render(
      <SegmentationEditor
        rows={[row(), row()]}
        onRowsChange={vi.fn()}
        disabled
      />,
    );
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });
});
