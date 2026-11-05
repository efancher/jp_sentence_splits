import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LiveShadowWaveform } from '../src/components/LiveShadowWaveform';

vi.mock('../src/lib/waveform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/waveform')>()),
  decodeAudioBuffer: vi.fn(async () => ({}) as AudioBuffer),
  canonicalizeAudioBuffer: vi.fn(() => ({ samples: new Float32Array(48_000 * 2), sampleRate: 48_000, durationSeconds: 2 })),
}));

const SAMPLE_RATE = 48_000;

/** A steady voiced tone: the learner "speaking" the whole time. */
function fakeAnalyser(): AnalyserNode {
  return {
    fftSize: 2048,
    getFloatTimeDomainData(target: Float32Array) {
      for (let i = 0; i < target.length; i += 1) target[i] = 0.4 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE);
    },
  } as unknown as AnalyserNode;
}

const numbers = (text: string | null) => (text ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];

/** x of the vertical dashed marker lines, left to right, and the right-most x of your (accent) line. */
function readChart(container: HTMLElement) {
  const svg = container.querySelector('svg[aria-label="Reference and live pitch contour"]')!;
  const markers = [...svg.querySelectorAll('line[stroke-dasharray]')].map((line) => Number(line.getAttribute('x1'))).sort((a, b) => a - b);
  const liveXs = [...svg.querySelectorAll('polyline[stroke="var(--accent)"]')].flatMap((line) =>
    numbers(line.getAttribute('points')).filter((_, index) => index % 2 === 0),
  );
  return { markers, liveMaxX: liveXs.length ? Math.max(...liveXs) : null, liveMinX: liveXs.length ? Math.min(...liveXs) : null };
}

describe('LiveShadowWaveform lead-in and pause window', () => {
  afterEach(() => vi.useRealTimers());

  it('draws your voice before the native starts and past its end, with markers where the native sits', async () => {
    const startedAt = performance.now();
    const clock = { phase: 'lead-in' as 'lead-in' | 'native' | 'pause', phaseAt: startedAt };
    const elapsedS = () => (performance.now() - clock.phaseAt) / 1000;
    const setPhase = (phase: typeof clock.phase) => {
      clock.phase = phase;
      clock.phaseAt = performance.now();
    };

    const { container } = render(
      <LiveShadowWaveform
        referenceBlob={new Blob(['ref'])}
        active
        analyser={fakeAnalyser()}
        sampleRate={SAMPLE_RATE}
        showWaveform={false}
        leadInMs={1500}
        tailMs={1500}
        playbackRate={1}
        // The countdown runs down through the lead-in; afterwards the reference clock runs 0 -> 2 s.
        getLeadInRemainingMs={() => (clock.phase === 'lead-in' ? Math.max(1, 1500 - elapsedS() * 1000) : 0)}
        getMediaTime={() => (clock.phase === 'native' ? Math.min(1.99, elapsedS() * 4) : clock.phase === 'pause' ? 2 : 0)}
        isHeld={() => clock.phase !== 'native'}
      />,
    );

    // Lead-in: the chart already has dashed markers for the native, and your line sits left of the native start.
    await waitFor(() => expect(readChart(container).liveMaxX).not.toBeNull(), { timeout: 4000 });
    let chart = readChart(container);
    expect(chart.markers).toHaveLength(2);
    const [nativeStart, nativeEnd] = chart.markers as [number, number];
    expect(nativeStart).toBeGreaterThan(0);
    expect(chart.liveMaxX!).toBeLessThanOrEqual(nativeStart + 1);

    // The native plays: your line moves into its span.
    setPhase('native');
    await waitFor(() => expect(readChart(container).liveMaxX!).toBeGreaterThan(nativeStart + 5), { timeout: 4000 });
    expect(readChart(container).liveMaxX!).toBeLessThanOrEqual(nativeEnd + 1);

    // The pause after the native: your line keeps going past where the native ended.
    setPhase('pause');
    await waitFor(() => expect(readChart(container).liveMaxX!).toBeGreaterThan(nativeEnd + 2), { timeout: 4000 });
    chart = readChart(container);
    expect(chart.liveMinX!).toBeLessThan(nativeStart);
  });

  it('is the native span only, with no markers, when no lead-in or pause is given', async () => {
    const { container } = render(
      <LiveShadowWaveform
        referenceBlob={new Blob(['ref'])}
        active
        analyser={fakeAnalyser()}
        sampleRate={SAMPLE_RATE}
        showWaveform={false}
        getMediaTime={() => 0.5}
      />,
    );
    await waitFor(() => expect(container.querySelector('svg[aria-label="Reference and live pitch contour"]')).not.toBeNull());
    expect(readChart(container).markers).toEqual([]);
  });
});
