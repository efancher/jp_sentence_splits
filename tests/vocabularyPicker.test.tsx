import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { VocabularyPicker } from '../src/components/VocabularyPicker';
import type {
  VocabularyReviewStatus,
  VocabularySelection,
} from '../src/domain/types';

const baseSelection: VocabularySelection = {
  id: 'sel-1',
  surface: '先輩',
  start: 0,
  end: 2,
  expression: '先輩',
  reading: 'せんぱい',
  pos: '名詞',
  source: 'manual',
};

function Harness({
  onSuggestMeaning,
}: {
  onSuggestMeaning?: (word: {
    expression: string;
    reading: string;
  }) => Promise<{ meaning: string; partOfSpeech?: string } | null>;
}) {
  const [selections, setSelections] = useState<VocabularySelection[]>([baseSelection]);
  const [reviewStatus, setReviewStatus] =
    useState<VocabularyReviewStatus>('unreviewed');
  return (
    <VocabularyPicker
      japanese="先輩、おはようございます。"
      suggestions={[]}
      selections={selections}
      reviewStatus={reviewStatus}
      onChange={({ selections: next, reviewStatus: status }) => {
        setSelections(next);
        setReviewStatus(status);
      }}
      onSuggestMeaning={onSuggestMeaning}
    />
  );
}

describe('VocabularyPicker "Suggest (AI)"', () => {
  it('is hidden when no onSuggestMeaning prop is supplied', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('button', { name: /suggest \(ai\)/i })).toBeNull();
  });

  it('fills the meaning field from the suggestion callback', async () => {
    const user = userEvent.setup();
    const onSuggestMeaning = vi
      .fn()
      .mockResolvedValue({ meaning: 'senior colleague', partOfSpeech: 'noun' });
    render(<Harness onSuggestMeaning={onSuggestMeaning} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: /suggest \(ai\)/i }));

    expect(onSuggestMeaning).toHaveBeenCalledWith({
      expression: '先輩',
      reading: 'せんぱい',
    });
    const meaningInput = await screen.findByDisplayValue('senior colleague');
    expect(meaningInput).toBeInTheDocument();
  });

  it('shows an inline message when the suggestion is unavailable', async () => {
    const user = userEvent.setup();
    render(<Harness onSuggestMeaning={vi.fn().mockResolvedValue(null)} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: /suggest \(ai\)/i }));

    expect(await screen.findByText(/no suggestion available/i)).toBeInTheDocument();
  });
});
