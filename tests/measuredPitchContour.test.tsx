import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MeasuredPitchContour } from '../src/components/MeasuredPitchContour';
import type { PitchFrame } from '../src/lib/pitch';

/** Frames spaced one 20ms hop apart, `rels[i]` null = unvoiced. */
function frames(rels: Array<number | null>): PitchFrame[] {
  return rels.map((relativeSemitones, index) => ({
    timeSeconds: index * 0.02,
    hz: relativeSemitones !== null ? 150 : null,
    voiced: relativeSemitones !== null,
    confidence: relativeSemitones !== null ? 0.9 : 0,
    relativeSemitones,
  }));
}

function payload(fr: PitchFrame[]) {
  return { frames: fr, medianHz: 150, voicedRatio: 1, durationSeconds: fr.length * 0.02 };
}

describe('MeasuredPitchContour', () => {
  it('renders nothing without a payload', () => {
    const { container } = render(<MeasuredPitchContour />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders nothing with fewer than two voiced frames', () => {
    const { container } = render(
      <MeasuredPitchContour payload={payload(frames([0, null, null]))} />,
    );
    expect(container.querySelector('svg')).toBeNull();
  });

  it('draws a single polyline for a continuously voiced contour', () => {
    const { container } = render(
      <MeasuredPitchContour payload={payload(frames([0, 1, 2, 1]))} />,
    );
    const lines = container.querySelectorAll('polyline');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.getAttribute('points')!.trim().split(' ').length).toBe(4);
  });

  it('breaks the line into separate runs across an unvoiced gap', () => {
    const { container } = render(
      <MeasuredPitchContour payload={payload(frames([0, 1, null, null, 2, 1]))} />,
    );
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
  });

  it('crops the x-axis to the voiced span so leading/trailing silence does not squash the line', () => {
    // 20 silent frames, 6 voiced, 20 silent — the contour should still span a
    // meaningful width, not collapse into the ~7% of the clip that has speech.
    const rels: Array<number | null> = [
      ...Array<null>(20).fill(null),
      0,
      1,
      2,
      2,
      1,
      0,
      ...Array<null>(20).fill(null),
    ];
    const { container } = render(<MeasuredPitchContour payload={payload(frames(rels))} />);
    const points = container
      .querySelector('polyline')!
      .getAttribute('points')!
      .trim()
      .split(' ')
      .map((pair) => Number(pair.split(',')[0]));
    expect(Math.max(...points) - Math.min(...points)).toBeGreaterThan(120);
  });

  it('renders the kana ruler under the contour when kana entries are given', () => {
    const { container, getByText } = render(
      <MeasuredPitchContour
        payload={payload(frames([0, 1, 2, 1]))}
        label="Your pitch (measured)"
        kana={[
          { text: 'り', start: 0, end: 0.2, leftPct: 0, widthPct: 50 },
          { text: 'んご', start: 0.2, end: 0.4, leftPct: 50, widthPct: 50 },
        ]}
      />,
    );
    expect(container.querySelector('[aria-label="Your pitch (measured) syllables"]')).not.toBeNull();
    expect(getByText('り')).toBeInTheDocument();
    expect(getByText('んご')).toBeInTheDocument();
  });

  it('renders no kana ruler for an empty kana list', () => {
    const { container } = render(
      <MeasuredPitchContour payload={payload(frames([0, 1]))} kana={[]} />,
    );
    expect(container.querySelector('[aria-label$="syllables"]')).toBeNull();
  });

  it('honours a custom height', () => {
    const { container } = render(
      <MeasuredPitchContour payload={payload(frames([0, 1, 2, 1]))} height={64} />,
    );
    expect(container.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 320 64');
  });

  it('draws a playhead + band only for an in-range progress value', () => {
    const fr = frames([0, 1, 2, 1]);

    const { container: none } = render(<MeasuredPitchContour payload={payload(fr)} />);
    expect(none.querySelector('.pitch-contour-playhead')).toBeNull();

    const { container: mid } = render(
      <MeasuredPitchContour payload={payload(fr)} progress={0.5} />,
    );
    const line = mid.querySelector('.pitch-contour-playhead');
    expect(line).not.toBeNull();
    expect(mid.querySelector('.pitch-contour-band')).not.toBeNull();

    const { container: outOfRange } = render(
      <MeasuredPitchContour payload={payload(fr)} progress={1.4} />,
    );
    expect(outOfRange.querySelector('.pitch-contour-playhead')).toBeNull();
  });
});
