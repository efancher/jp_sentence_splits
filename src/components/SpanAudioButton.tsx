import { useEffect, useRef, useState } from 'react';

/**
 * A play button for an audio span fetched on demand — used across the
 * mining wizard so every stage can hear the source without pre-clipping.
 * The fetch + `Audio.play()` happen inside the click handler so iOS
 * Safari's gesture gate is satisfied (see the iOS-audio-gesture memory).
 */
export function SpanAudioButton({
  fetchAudio,
  label = 'play',
  disabled = false,
}: {
  fetchAudio: () => Promise<Blob>;
  label?: string;
  disabled?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function play() {
    if (state === 'loading') return;
    const existing = audioRef.current;
    if (existing) {
      existing.currentTime = 0;
      setState('playing');
      await existing.play().catch(() => setState('idle'));
      return;
    }
    setState('loading');
    try {
      const blob = await fetchAudio();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = new Audio(url);
      audio.onended = () => setState('idle');
      audio.onpause = () => setState((s) => (s === 'playing' ? 'idle' : s));
      audioRef.current = audio;
      setState('playing');
      await audio.play();
    } catch {
      setState('error');
    }
  }

  return (
    <button type="button" disabled={disabled || state === 'loading'} onClick={() => void play()}>
      {state === 'loading'
        ? '…'
        : state === 'error'
          ? '⚠ audio'
          : state === 'playing'
            ? '▶ …'
            : `▶ ${label}`}
    </button>
  );
}
