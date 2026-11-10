import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PitchAccentWordMarks } from '../src/components/PitchAccentWordMarks';
import { buildSentencePitchAccents } from '../src/lib/sentencePitchAccent';

function marks(positions: number[]) {
  const [word] = buildSentencePitchAccents('雨が降る', [
    { surfaceForm: '雨', reading: 'あめ', pitchAccentPositions: positions },
  ]);
  return <PitchAccentWordMarks word={word!} />;
}

describe('PitchAccentWordMarks', () => {
  it('flags a word whose dictionary lists more than one accent', () => {
    render(marks([1, 0]));
    const flag = screen.getByRole('img', { name: /also lists: heiban \[0\]/i });
    expect(flag).toHaveAttribute('title', expect.stringContaining('atamadaka [1]'));
  });

  it('shows no flag for a single accent', () => {
    render(marks([1]));
    expect(screen.queryByRole('img')).toBeNull();
  });
});
