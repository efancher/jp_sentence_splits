import type { SentenceAudio } from '../domain/types';
import { useJapaneseSpeech } from '../hooks/useJapaneseSpeech';
import { useNativeAudio } from '../hooks/useNativeAudio';

interface NativeAudioButtonProps {
  audio: SentenceAudio;
  displayLabel?: string;
}

export function NativeAudioButton({
  audio,
  displayLabel = 'Native',
}: NativeAudioButtonProps) {
  const native = useNativeAudio();
  const speech = useJapaneseSpeech();
  const active = native.isPlaying && native.activeItemId === audio.id;

  return (
    <button
      type="button"
      className={`speak-button${active ? ' speaking' : ''}`}
      aria-label={
        active
          ? 'Stop native sentence recording'
          : `Play native sentence recording from ${audio.sourceTitle}`
      }
      aria-pressed={active}
      onClick={() => {
        if (active) {
          native.stop();
          return;
        }
        speech.stop();
        void native.play(audio);
      }}
    >
      {active ? '🎧 Playing…' : `🎧 ${displayLabel}`}
    </button>
  );
}
