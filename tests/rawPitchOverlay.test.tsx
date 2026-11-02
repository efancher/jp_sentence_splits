import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RawPitchOverlay, rawPitchRuns, rawPitchScale } from '../src/components/RawPitchOverlay';
import type { PitchAnalysisPayload } from '../src/lib/pitch';

function track(durationSeconds: number, points: Array<[number, number | null]>): PitchAnalysisPayload {
  return {
    durationSeconds,
    medianHz: 120,
    voicedRatio: 1,
    frames: points.map(([timeSeconds, hz]) => ({
      timeSeconds,
      hz,
      voiced: hz !== null,
      confidence: 1,
      relativeSemitones: null,
    })),
  };
}

describe('rawPitchScale', () => {
  it('uses the longer clip duration and spans both contours in absolute Hz', () => {
    const scale = rawPitchScale(track(2, [[0.5, 200]]), track(3, [[1, 100]]));
    expect(scale?.durationSeconds).toBe(3);
    expect(scale!.minHz).toBeLessThan(100);
    expect(scale!.maxHz).toBeGreaterThan(200);
  });

  it('is null when nothing is voiced', () => {
    expect(rawPitchScale(track(2, [[0.5, null]]), undefined)).toBeNull();
  });
});

describe('rawPitchRuns', () => {
  it('breaks runs at unvoiced frames', () => {
    const pitch = track(1, [[0.1, 100], [0.2, 110], [0.3, null], [0.4, 120], [0.5, 125]]);
    const scale = rawPitchScale(pitch, undefined)!;
    expect(rawPitchRuns(pitch, scale)).toHaveLength(2);
  });

  it('places the same time at the same x and the same Hz at the same y regardless of clip', () => {
    const a = track(2, [[1, 150], [1.1, 150]]);
    const b = track(3, [[1, 150], [1.1, 150]]);
    const scale = rawPitchScale(a, b)!;
    expect(rawPitchRuns(a, scale)).toEqual(rawPitchRuns(b, scale));
  });
});

describe('RawPitchOverlay', () => {
  it('draws one line per voiced run for each clip', () => {
    const { container } = render(
      <RawPitchOverlay
        reference={track(2, [[0.1, 200], [0.2, 210]])}
        learner={track(2, [[0.1, 100], [0.2, 105], [0.3, null], [0.4, 100], [0.5, 98]])}
      />,
    );
    expect(container.querySelectorAll('polyline')).toHaveLength(3);
  });

  it('explains when there is nothing voiced', () => {
    render(<RawPitchOverlay reference={undefined} learner={undefined} />);
    expect(screen.getByText(/too little voiced sound/i)).toBeTruthy();
  });
});
