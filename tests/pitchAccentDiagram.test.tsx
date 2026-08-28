import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PitchAccentDiagram } from '../src/components/PitchAccentDiagram';

describe('PitchAccentDiagram', () => {
  it('renders one node per mora plus a trailing particle node', () => {
    const { container } = render(<PitchAccentDiagram reading="おなじ" position={0} />);
    // 3 morae + 1 particle
    expect(container.querySelectorAll('circle')).toHaveLength(4);
    expect(container.querySelectorAll('text')).toHaveLength(3);
    expect(container.querySelector('title')?.textContent).toContain('heiban');
  });

  it('keeps the particle node high only for heiban', () => {
    const { container: heiban } = render(<PitchAccentDiagram reading="おなじ" position={0} />);
    const { container: odaka } = render(<PitchAccentDiagram reading="おとこ" position={3} />);
    const particleY = (c: HTMLElement) => {
      const circles = [...c.querySelectorAll('circle')];
      return circles[circles.length - 1]!.getAttribute('cy');
    };
    // heiban: within-word shape is identical to odaka (l,h,h) — only the
    // particle disambiguates, so it must differ between the two.
    expect(particleY(heiban)).not.toEqual(particleY(odaka));
  });

  it('drops after the accent nucleus for atamadaka', () => {
    const { container } = render(<PitchAccentDiagram reading="あめ" position={1} />);
    expect(container.querySelector('title')?.textContent).toContain('atamadaka');
    const [first, second] = [...container.querySelectorAll('circle')];
    // mora 1 high, mora 2 low
    expect(Number(first!.getAttribute('cy'))).toBeLessThan(Number(second!.getAttribute('cy')));
  });

  it('renders nothing for an empty reading', () => {
    const { container } = render(<PitchAccentDiagram reading="" position={0} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
