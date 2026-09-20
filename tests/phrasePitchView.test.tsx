import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PhrasePitchView } from '../src/components/PhrasePitchView';
import type { PhrasePitchResult, PhraseRow } from '../src/lib/phrasePitch';

const row = (overrides: Partial<PhraseRow> = {}): PhraseRow => ({
  text: 'はしが',
  kana: ['は', 'し', 'が'],
  native: ['l', 'h', 'l'],
  nativeContrast: 4,
  nativeLevels: [0, 1, 0],
  learner: ['h', 'h', 'l'],
  learnerContrast: 4,
  learnerLevels: [1, 1, 0],
  status: 'different',
  nativeSummary: 'starts low, rises, then falls after し',
  learnerSummary: 'starts high, then falls after し',
  ...overrides,
});

const result = (rows: PhraseRow[], extra: Partial<PhrasePitchResult> = {}): PhrasePitchResult => ({
  rows,
  learnerUnavailable: false,
  learnerApproximateTokens: 0,
  ...extra,
});

describe('PhrasePitchView', () => {
  it('shows native and learner H/L per mora and flags the mismatch', () => {
    render(<PhrasePitchView result={result([row()])} hasLearner />);
    const group = screen.getByRole('group', { name: 'Pitch of はしが' });
    const native = within(group).getAllByTitle('Native').map((el) => el.textContent);
    expect(native).toEqual(['L', 'H', 'L']);
    const differs = within(group).getAllByTitle('Your recording differs here');
    expect(differs).toHaveLength(1);
    expect(differs[0]).toHaveAttribute('data-mismatch');
    expect(within(group).getAllByTitle('Your recording matches here')).toHaveLength(2);
    expect(screen.getByText(/Native: starts low, rises, then falls after し\. You: starts high/)).toBeInTheDocument();
  });

  it('counts matching phrases in the header', () => {
    render(
      <PhrasePitchView
        result={result([row({ status: 'match' }), row({ text: 'たかい', status: 'different' }), row({ text: 'x', status: 'weak-native' })])}
        hasLearner
      />,
    );
    expect(screen.getByText('1 of 2 phrases match')).toBeInTheDocument();
  });

  it('shows only the native side without a learner recording', () => {
    render(<PhrasePitchView result={result([row({ learner: null, learnerLevels: null, status: 'no-learner' })])} hasLearner={false} />);
    expect(screen.getByText('Phrase pitch — native')).toBeInTheDocument();
    expect(screen.queryByTitle('Your recording differs here')).toBeNull();
    expect(screen.getByText('Native: starts low, rises, then falls after し.')).toBeInTheDocument();
  });

  it('explains when the learner recording could not be lined up', () => {
    render(<PhrasePitchView result={result([row({ learner: null, learnerLevels: null, status: 'no-learner' })], { learnerUnavailable: true })} hasLearner />);
    expect(screen.getByText(/couldn’t be lined up with the native words/)).toBeInTheDocument();
    expect(screen.queryByTitle('Your recording differs here')).toBeNull();
  });

  it('notes when some of your words were only timed roughly', () => {
    render(<PhrasePitchView result={result([row()], { learnerApproximateTokens: 2 })} hasLearner />);
    expect(screen.getByText(/2 words of your recording could only be timed roughly/)).toBeInTheDocument();
  });

  it('says why nothing is shown when the native timing is unavailable', () => {
    render(<PhrasePitchView result={result([], { unavailable: 'no-reference-timing' })} hasLearner />);
    expect(screen.getByText(/alignment doesn’t line up/)).toBeInTheDocument();
  });

  it('gives a plain line for a flat learner phrase', () => {
    render(<PhrasePitchView result={result([row({ status: 'flat' })])} hasLearner />);
    expect(screen.getByText(/Your pitch is flat here\. The native phrase starts low/)).toBeInTheDocument();
  });
});
