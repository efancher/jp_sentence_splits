import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MeasuredPitchContour } from '../src/components/MeasuredPitchContour';
import type { PitchFrame } from '../src/lib/pitch';

function frame(relativeSemitones: number | null): PitchFrame {
  const voiced = relativeSemitones !== null;
  return {
    timeSeconds: 0,
    hz: voiced ? 150 : null,
    voiced,
    confidence: voiced ? 0.9 : 0,
    relativeSemitones,
  };
}

function payload(frames: PitchFrame[]) {
  return { frames, medianHz: 150, voicedRatio: 1, durationSeconds: frames.length * 0.02 };
}

describe('MeasuredPitchContour', () => {
  it('renders nothing without a payload', () => {
    const { container } = render(<MeasuredPitchContour />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders nothing with fewer than two voiced frames', () => {
    const { container } = render(
      <MeasuredPitchContour payload={payload([frame(0), frame(null), frame(null)])} />,
    );
    expect(container.querySelector('svg')).toBeNull();
  });

  it('draws a single polyline for a continuously voiced contour', () => {
    const { container } = render(
      <MeasuredPitchContour payload={payload([frame(0), frame(1), frame(2), frame(1)])} />,
    );
    const lines = container.querySelectorAll('polyline');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.getAttribute('points')!.trim().split(' ').length).toBe(4);
  });

  it('breaks the line into separate runs across an unvoiced gap', () => {
    const { container } = render(
      <MeasuredPitchContour
        payload={payload([
          frame(0),
          frame(1),
          frame(null),
          frame(null),
          frame(2),
          frame(1),
        ])}
      />,
    );
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
  });

  it('draws a playhead + band only for an in-range progress value', () => {
    const frames = [frame(0), frame(1), frame(2), frame(1)];

    const { container: none } = render(<MeasuredPitchContour payload={payload(frames)} />);
    expect(none.querySelector('.pitch-contour-playhead')).toBeNull();

    const { container: mid } = render(
      <MeasuredPitchContour payload={payload(frames)} progress={0.5} />,
    );
    const line = mid.querySelector('.pitch-contour-playhead');
    expect(line).not.toBeNull();
    expect(line!.getAttribute('x1')).toBe('160'); // 0.5 * 320
    expect(mid.querySelector('.pitch-contour-band')).not.toBeNull();

    const { container: outOfRange } = render(
      <MeasuredPitchContour payload={payload(frames)} progress={1.4} />,
    );
    expect(outOfRange.querySelector('.pitch-contour-playhead')).toBeNull();
  });
});
