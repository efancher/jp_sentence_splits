import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { PatternExamples } from '../src/components/PatternExamples';
import type { GrammarEncounter } from '../src/db/repository';
import { formsSeen, lineUpExamples, splitAtSpan } from '../src/lib/grammarExamples';

const encounter = (
  id: string,
  japanese: string,
  span: { surfaceForm?: string; start?: number; end?: number },
  extra: { translation?: string; note?: string; createdAt?: string } = {},
): GrammarEncounter =>
  ({
    sentenceGrammar: {
      id: `sg-${id}`,
      sentenceId: id,
      grammarPatternId: 'p',
      occurrenceExplanation: extra.note,
      confirmedByLearner: false,
      source: 'ai_suggested',
      createdAt: extra.createdAt ?? '2026-10-31T00:00:00.000Z',
      updatedAt: '2026-10-31T00:00:00.000Z',
      ...span,
    },
    sentence: { id, japanese, translation: extra.translation ?? '' },
    books: [{ id: 'b1', title: 'Book' }],
    audio: [],
  }) as unknown as GrammarEncounter;

const SHORT = encounter('s1', '窓が開いている。', { surfaceForm: '開いている', start: 2, end: 7 }, { translation: 'The window is open.', note: 'resulting state' });
const LONG = encounter('s2', '彼は毎日この部屋で本を読んでいる。', { surfaceForm: '読んでいる', start: 12, end: 17 });
const SAME_FORM = encounter('s3', '窓が開いている。そして風が入る。', { surfaceForm: '開いている', start: 2, end: 7 });

describe('splitAtSpan', () => {
  it('splits around the stored span while it still selects the surface form', () => {
    expect(splitAtSpan('窓が開いている。', { surfaceForm: '開いている', start: 2, end: 7 })).toEqual({
      before: '窓が',
      match: '開いている',
      after: '。',
    });
  });

  it('searches for the surface form when the offsets are stale, and gives up when it is gone', () => {
    expect(splitAtSpan('とても窓が開いている。', { surfaceForm: '開いている', start: 2, end: 7 })?.before).toBe('とても窓が');
    expect(splitAtSpan('窓が閉まっている。', { surfaceForm: '開いている', start: 2, end: 7 })).toBeNull();
  });

  it('has nothing to highlight without a surface form', () => {
    expect(splitAtSpan('窓が開いている。', {})).toBeNull();
  });
});

describe('lineUpExamples and formsSeen', () => {
  it('orders simplest first, skips encounters without a span, and counts forms most common first', () => {
    const noSpan = encounter('s4', '短い。', {});
    const lined = lineUpExamples([LONG, noSpan, SAME_FORM, SHORT]);
    expect(lined.map((example) => example.item.sentence.id)).toEqual(['s1', 's3', 's2']);
    expect(formsSeen(lined)).toEqual([
      { form: '開いている', count: 2 },
      { form: '読んでいる', count: 1 },
    ]);
  });
});

describe('PatternExamples', () => {
  const renderExamples = (encounters: GrammarEncounter[]) =>
    render(
      <MemoryRouter>
        <PatternExamples encounters={encounters} />
      </MemoryRouter>,
    );

  it('stays hidden until there are two sentences with a span to compare', () => {
    const { container } = renderExamples([SHORT, encounter('s4', '短い。', {})]);
    expect(container).toBeEmptyDOMElement();
  });

  it('highlights the pattern in each sentence, simplest first, with translation and note', () => {
    renderExamples([LONG, SHORT]);
    expect(screen.getByText('Lined up (2)')).toBeInTheDocument();
    const rows = document.querySelectorAll('.kwic-row');
    expect(Array.from(rows).map((row) => row.querySelector('mark')?.textContent)).toEqual(['開いている', '読んでいる']);
    expect(rows[0]!.querySelector('.kwic-before')?.textContent).toBe('窓が');
    expect(screen.getByText('The window is open.')).toBeInTheDocument();
    expect(screen.getByText('resulting state')).toBeInTheDocument();
    expect(rows[0]!.closest('a')).toHaveAttribute('href', '/books/b1/analyze/s1');
  });

  it('filters to one form when a form is chosen and clears it when chosen again', async () => {
    renderExamples([LONG, SHORT, SAME_FORM]);
    const forms = screen.getByLabelText('Forms you have met');
    const open = within(forms).getByRole('button', { name: '開いている (2)' });
    await userEvent.click(open);
    expect(open).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelectorAll('.kwic-row')).toHaveLength(2);
    await userEvent.click(open);
    expect(document.querySelectorAll('.kwic-row')).toHaveLength(3);
  });

  it('offers no form filter when every example uses the same form', () => {
    renderExamples([SHORT, SAME_FORM]);
    expect(screen.queryByLabelText('Forms you have met')).not.toBeInTheDocument();
  });
});
