import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SentenceHighLow } from '../src/components/SentenceHighLow';
import type { PhrasePitchResult, PhraseRow } from '../src/lib/phrasePitch';

const row = (overrides: Partial<PhraseRow>): PhraseRow => ({
  text: '',
  kana: [],
  nativeLevels: [],
  learnerLevels: null,
  nativeContour: [],
  learnerContour: null,
  learnerVoicedMorae: null,
  phraseIndex: 0,
  moraSpansMs: [],
  ...overrides,
});

const result = (extra: Partial<PhrasePitchResult>): PhrasePitchResult => ({
  rows: [],
  unmeasured: [],
  learnerUnavailable: true,
  learnerApproximateTokens: 0,
  ...extra,
});

describe('SentenceHighLow', () => {
  it('lays the phrases out in sentence order with native H/L, holding a gap for an unmeasured phrase', () => {
    const { container } = render(
      <SentenceHighLow
        result={result({
          rows: [
            row({ text: '私は', kana: ['わ', 'た', 'し', 'は'], nativeLevels: [0, 1, 1, 1], phraseIndex: 1 }),
            row({ text: '音楽が', kana: ['お', 'ん', 'が'], nativeLevels: [0, 1, 0.2], phraseIndex: 3 }),
          ],
          unmeasured: [{ phraseIndex: 2, text: 'ね', reason: 'short' }],
        })}
      />,
    );
    expect(screen.getByLabelText('わたしは: L H H H')).toBeInTheDocument();
    expect(screen.getByLabelText('おんが: L H L')).toBeInTheDocument();
    const order = [...container.querySelectorAll('.pa-kana')].map((n) => n.textContent).join('');
    expect(order).toBe('わたしはねおんが');
    expect(screen.getByTitle('Not measured')).toBeInTheDocument();
  });

  it('marks the morae of the phrase being shadowed, and nothing else', () => {
    const spans = (starts: number[]) => starts.map((startMs) => ({ startMs, endMs: startMs + 100 }));
    const { container } = render(
      <SentenceHighLow
        highlight={{ startMs: 200, endMs: 400 }}
        result={result({
          rows: [row({ text: '音楽', kana: ['お', 'ん', 'が', 'く'], nativeLevels: [0, 1, 1, 0], moraSpansMs: spans([0, 100, 200, 300]) })],
        })}
      />,
    );
    const marked = [...container.querySelectorAll('.pa-kana.pa-marked')].map((n) => n.textContent);
    expect(marked).toEqual(['が', 'く']);
    expect(container.querySelectorAll('.pa-hl.pa-marked')).toHaveLength(2);
  });

  it('renders nothing when phrase pitch is unavailable', () => {
    const { container } = render(<SentenceHighLow result={result({ unavailable: 'no-reference-timing' })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
