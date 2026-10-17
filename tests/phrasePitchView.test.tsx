import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PhrasePitchView } from '../src/components/PhrasePitchView';
import type { PhrasePitchResult, PhraseRow } from '../src/lib/phrasePitch';

const row = (overrides: Partial<PhraseRow> = {}): PhraseRow => ({
  text: 'はしが',
  kana: ['は', 'し', 'が'],
  nativeLevels: [0, 1, 0],
  learnerLevels: [1, 1, 0],
  learnerVoicedMorae: 3,
  ...overrides,
});

const result = (rows: PhraseRow[], extra: Partial<PhrasePitchResult> = {}): PhrasePitchResult => ({
  rows,
  learnerUnavailable: false,
  learnerApproximateTokens: 0,
  ...extra,
});

describe('PhrasePitchView', () => {
  it('draws the native and your contour for a phrase, with the kana under it and no H/L labels', () => {
    const { container } = render(<PhrasePitchView result={result([row()])} hasLearner />);
    expect(screen.getByRole('img', { name: 'Pitch of はしが, native and yours' })).toBeInTheDocument();
    expect(container.querySelectorAll('polyline.apg-line-native')).toHaveLength(1);
    expect(container.querySelectorAll('polyline.apg-line-attempt')).toHaveLength(1);
    expect(['は', 'し', 'が'].every((k) => screen.getAllByText(k).length > 0)).toBe(true);
    expect(screen.queryByText('H')).toBeNull();
    expect(screen.queryByText(/phrases match/)).toBeNull();
  });

  it('shows only the native contour without a learner recording', () => {
    const { container } = render(<PhrasePitchView result={result([row({ learnerLevels: null, learnerVoicedMorae: null })])} hasLearner={false} />);
    expect(screen.getByText('Phrase pitch — native')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Pitch of はしが, native' })).toBeInTheDocument();
    expect(container.querySelectorAll('polyline.apg-line-attempt')).toHaveLength(0);
  });

  it('explains when the learner recording could not be lined up', () => {
    render(<PhrasePitchView result={result([row({ learnerLevels: null, learnerVoicedMorae: null })], { learnerUnavailable: true })} hasLearner />);
    expect(screen.getByText(/couldn’t be lined up with the native words/)).toBeInTheDocument();
  });

  it('notes when some of your words were only timed roughly', () => {
    render(<PhrasePitchView result={result([row()], { learnerApproximateTokens: 2 })} hasLearner />);
    expect(screen.getByText(/2 words of your recording could only be timed roughly/)).toBeInTheDocument();
  });

  it('says how many sounds had a clear pitch when yours could not be measured', () => {
    render(<PhrasePitchView result={result([row({ learnerLevels: null, learnerVoicedMorae: 1 })])} hasLearner />);
    expect(screen.getByText(/only 1 of 3 sounds had a clear pitch/)).toBeInTheDocument();
  });

  it('says why nothing is shown when the native timing is unavailable', () => {
    render(<PhrasePitchView result={result([], { unavailable: 'no-reference-timing' })} hasLearner />);
    expect(screen.getByText(/none of this sentence’s words could be/)).toBeInTheDocument();
  });

  it('sends a report with the note and confirms', async () => {
    const onReport = vi.fn().mockResolvedValue(undefined);
    render(<PhrasePitchView result={result([row()])} hasLearner onReport={onReport} />);
    await userEvent.click(screen.getByRole('button', { name: 'Report a problem with this' }));
    await userEvent.type(screen.getByLabelText('What looks wrong?'), 'kana are on the wrong sounds');
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(screen.getByText(/Reported — it will show up/)).toBeInTheDocument());
    expect(onReport).toHaveBeenCalledWith('kana are on the wrong sounds');
  });

  it('lets you report even when nothing could be shown, and shows a failure', async () => {
    const onReport = vi.fn().mockRejectedValue(new Error('disk full'));
    render(<PhrasePitchView result={result([], { unavailable: 'no-reference-timing' })} hasLearner onReport={onReport} />);
    await userEvent.click(screen.getByRole('button', { name: 'Report a problem with this' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(screen.getByText('disk full')).toBeInTheDocument());
    expect(onReport).toHaveBeenCalledWith('');
  });

  it('has no report button unless a handler is given', () => {
    render(<PhrasePitchView result={result([row()])} hasLearner />);
    expect(screen.queryByRole('button', { name: 'Report a problem with this' })).toBeNull();
  });
});
