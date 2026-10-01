import { useJapaneseSpeech } from '../hooks/useJapaneseSpeech';
import { useNativeAudio } from '../hooks/useNativeAudio';

interface SpeakButtonProps {
  /** Exact Japanese text to speak. */
  text: string;
  /** Unique id used for the shared active-playback state. */
  itemId: string;
  /** Accessible name, e.g. "Play Japanese sentence". */
  label: string;
  compact?: boolean;
  displayLabel?: string;
  /** Speaker glyph only; the accessible name and tooltip still carry the label. */
  iconOnly?: boolean;
}

/**
 * Icon speaker button. Tapping starts playback; tapping the button whose
 * text is currently speaking stops it. Disabled when the browser lacks
 * speech synthesis support.
 */
export function SpeakButton({
  text,
  itemId,
  label,
  compact,
  displayLabel,
  iconOnly,
}: SpeakButtonProps) {
  const { supported, isSpeaking, activeItemId, speak, stop } = useJapaneseSpeech();
  const nativeAudio = useNativeAudio();
  const active = isSpeaking && activeItemId === itemId;

  return (
    <button
      type="button"
      className={`speak-button${compact ? ' compact' : ''}${active ? ' speaking' : ''}`}
      aria-label={active ? `Stop playback: ${label}` : label}
      aria-pressed={active}
      disabled={!supported || !text.trim()}
      title={
        supported ? (iconOnly ? label : undefined) : 'Speech synthesis is not supported by this browser.'
      }
      onClick={() => {
        if (active) {
          stop();
        } else {
          nativeAudio.stop();
          speak(text, { itemId });
        }
      }}
    >
      {iconOnly ? '🔊' : active ? '🔊 Speaking…' : `🔊${displayLabel ? ` ${displayLabel}` : ''}`}
    </button>
  );
}
