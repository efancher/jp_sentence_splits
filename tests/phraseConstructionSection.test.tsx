import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PhraseConstructionSection } from '../src/components/PhraseConstructionSection';
import { parseConstructions } from '../src/lib/phraseConstruction';

const sentences = [
  { id: 's1', japanese: '本を読んでいるのが好きだ。', position: 1 },
  { id: 's2', japanese: '音楽を聞いているのが楽しい。', position: 2 },
];
const layer = (text: string, key: string, operation: string, extra: Record<string, unknown> = {}) => ({
  text, key, operation, attach: 'ATTACH-' + key, contribution: 'CONTRIB-' + key, ...extra,
});
const { drafts } = parseConstructions(
  {
    S1: [
      layer('読んで', 'te_form', 'inflection', { from: '読む' }),
      layer('読んでいる', 'te_iru', 'helper'),
      layer('本を読んでいるの', 'no_nominaliser', 'role_change', { scope: 'the whole clause' }),
    ],
    S2: [layer('聞いているの', 'no_nominaliser', 'role_change')],
  },
  { sentences },
);
const all = [...drafts].flatMap(([sentenceId, ls]) => ls.map((l) => ({ ...l, sentenceId })));

function setup(overrides: Partial<Parameters<typeof PhraseConstructionSection>[0]> = {}) {
  const onEvent = vi.fn();
  render(
    <PhraseConstructionSection
      sentence={sentences[0]!}
      layers={drafts.get('s1')!}
      allLayers={all}
      startSpan={{ start: 2, end: 7 }}
      episodeSentences={sentences}
      events={[]}
      visitId="v"
      quietMode={false}
      onEvent={onEvent}
      {...overrides}
    />,
  );
  return onEvent;
}

describe('PhraseConstructionSection', () => {
  it('is collapsed by default and opens on the layer matching the target', () => {
    setup();
    expect(screen.queryByText('ATTACH-te_iru')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'How this phrase works' }));
    expect(screen.getByText('ATTACH-te_iru')).toBeTruthy();
    expect(screen.queryByText('ATTACH-te_form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /読んで — Inflection/ }));
    expect(screen.getByText('ATTACH-te_form')).toBeTruthy();
    expect(screen.getAllByText('Use this elsewhere').length).toBe(2);
  });

  it('logs only a compare exposure, never practice, and shows the other use', () => {
    const onEvent = setup({ startSpan: { start: 0, end: 8 } });
    fireEvent.click(screen.getByRole('button', { name: 'How this phrase works' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare uses' }));
    expect(screen.getByText('What stays the same? What changes here?')).toBeTruthy();
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0]![0]).toMatchObject({ action: 'compare_uses_viewed', exposedSentenceId: 's2' });
  });

  it('says so when no comparison exists and hides a flagged layer', () => {
    const onEvent = setup({ allLayers: all.filter((l) => l.sentenceId === 's1'), startSpan: { start: 0, end: 8 } });
    fireEvent.click(screen.getByRole('button', { name: 'How this phrase works' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare uses' }));
    expect(screen.getByText(/No other reliable use/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'This explanation looks wrong' }));
    expect(onEvent.mock.calls.at(-1)![0]).toMatchObject({ action: 'content_report' });
    expect(screen.queryByText('ATTACH-no_nominaliser')).toBeNull();
  });

  it('renders nothing without layers', () => {
    const { container } = render(
      <PhraseConstructionSection sentence={sentences[0]!} layers={[]} allLayers={[]} episodeSentences={sentences} events={[]} visitId="v" quietMode={false} onEvent={() => {}} />,
    );
    expect(container.textContent).toBe('');
  });
});
