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
  saveState,
}: {
  onSuggestMeaning?: (word: {
    expression: string;
    reading: string;
  }) => Promise<{ meaning: string; partOfSpeech?: string } | null>;
  saveState?: 'idle' | 'dirty' | 'saving' | 'saved' | 'failed';
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
      saveState={saveState}
      onChange={({ selections: next, reviewStatus: status }) => {
        setSelections(next);
        setReviewStatus(status);
      }}
      onConfirm={() => {}}
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

  it('shows inline "Confirmed" feedback next to the button after confirming', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.queryByText(/confirmed ✓/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Confirm vocabulary' }));
    expect(await screen.findByText(/confirmed ✓/i)).toBeInTheDocument();
  });

  it('reflects the parent save state in the inline confirmation feedback', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness saveState="saving" />);
    await user.click(screen.getByRole('button', { name: 'Confirm vocabulary' }));
    expect(screen.getByText(/confirmed — saving…/i)).toBeInTheDocument();

    rerender(<Harness saveState="failed" />);
    expect(screen.getByText(/confirmed — save failed/i)).toBeInTheDocument();
  });

  it('shows an inline message when the suggestion is unavailable', async () => {
    const user = userEvent.setup();
    render(<Harness onSuggestMeaning={vi.fn().mockResolvedValue(null)} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: /suggest \(ai\)/i }));

    expect(await screen.findByText(/no suggestion available/i)).toBeInTheDocument();
  });
});

describe('VocabularyPicker missing-meaning check', () => {
  function MeaningHarness({ selections }: { selections: VocabularySelection[] }) {
    const [current, setCurrent] = useState(selections);
    const [reviewStatus, setReviewStatus] =
      useState<VocabularyReviewStatus>('unreviewed');
    return (
      <VocabularyPicker
        japanese="先輩、おはようございます。"
        suggestions={[]}
        selections={current}
        reviewStatus={reviewStatus}
        onChange={({ selections: next, reviewStatus: status }) => {
          setCurrent(next);
          setReviewStatus(status);
        }}
        onConfirm={() => {}}
      />
    );
  }

  it('flags a content-word selection with no meaning', () => {
    render(<MeaningHarness selections={[{ ...baseSelection, english: undefined }]} />);
    expect(screen.getByText('No meaning set')).toBeInTheDocument();
  });

  it('does not flag it once a meaning is filled in', () => {
    render(
      <MeaningHarness
        selections={[{ ...baseSelection, english: 'senior colleague' }]}
      />,
    );
    expect(screen.queryByText('No meaning set')).toBeNull();
  });

  it('does not flag a particle selection that has no meaning', () => {
    render(
      <MeaningHarness
        selections={[
          {
            id: 'sel-p',
            surface: 'を',
            start: 2,
            end: 3,
            expression: 'を',
            reading: 'を',
            pos: '助詞/格助詞',
            source: 'manual',
          },
        ]}
      />,
    );
    expect(screen.queryByText('No meaning set')).toBeNull();
  });
});
