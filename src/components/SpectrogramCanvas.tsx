import { useEffect, useRef } from 'react';

import type { Spectrogram } from '../lib/spectrogram';

/**
 * Draws a `Spectrogram` to a canvas — time on X, frequency on Y (0 at the
 * bottom), grayscale where louder = brighter (the Praat convention, and
 * legible on the app's dark panels). Used stacked, reference above attempt,
 * in `AnalysisPanel`. `pxPerSecond` is shared between the two so equal
 * durations line up; the canvas element then scales to its container.
 */
export function SpectrogramCanvas({
  spectrogram,
  label,
  maxHz = 4000,
  pxPerSecond = 120,
  height = 120,
}: {
  spectrogram: Spectrogram;
  label: string;
  maxHz?: number;
  pxPerSecond?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { frames, binHz, frameSeconds } = spectrogram;
    const topBin = Math.max(1, Math.min(spectrogram.bins, Math.round(maxHz / binHz)));
    const width = Math.max(1, Math.round(frames.length * frameSeconds * pxPerSecond));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const image = ctx.createImageData(width, height);
    const colWidth = width / Math.max(1, frames.length);
    for (let x = 0; x < width; x += 1) {
      const frame = frames[Math.min(frames.length - 1, Math.floor(x / colWidth))];
      if (!frame) continue;
      for (let y = 0; y < height; y += 1) {
        // y=0 is the top of the canvas → highest frequency.
        const bin = Math.round((1 - y / height) * (topBin - 1));
        const db = frame[bin] ?? -70;
        // -70 dB → 0, 0 dB → 255, with a gentle gamma so mid-energy shows.
        const t = Math.max(0, Math.min(1, (db + 70) / 70));
        const v = Math.round(255 * Math.pow(t, 1.6));
        const i = (y * width + x) * 4;
        image.data[i] = v;
        image.data[i + 1] = v;
        image.data[i + 2] = v;
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [spectrogram, maxHz, pxPerSecond, height]);

  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="muted" style={{ fontSize: '0.8em' }}>
        {label} · 0–{(maxHz / 1000).toFixed(0)} kHz
      </figcaption>
      <canvas
        ref={canvasRef}
        aria-label={`${label} spectrogram`}
        role="img"
        style={{
          width: '100%',
          height,
          display: 'block',
          background: '#000',
          imageRendering: 'pixelated',
        }}
      />
    </figure>
  );
}
