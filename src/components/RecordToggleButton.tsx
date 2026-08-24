/**
 * Single Record/Stop control — one button whose label and action flip
 * between "start" and "stop" instead of showing two separate buttons side
 * by side. Shared by ShadowPage's free-form controls and every recording
 * stage of ProgressiveShadowingPanel (docs/AI_OVERVIEW.md §6) so the fix
 * for "too many things to think about while recording" applies everywhere.
 */
export function RecordToggleButton({
  isRecording,
  isRequestingMic,
  elapsedMs,
  maxDurationMs,
  disabled,
  idleLabel,
  onStart,
  onStop,
}: {
  isRecording: boolean;
  isRequestingMic: boolean;
  elapsedMs?: number;
  maxDurationMs?: number;
  disabled?: boolean;
  idleLabel: string;
  onStart: () => void;
  onStop: () => void;
}) {
  if (isRecording) {
    const elapsedLabel =
      elapsedMs !== undefined
        ? maxDurationMs !== undefined
          ? ` ${Math.ceil(elapsedMs / 1000)}s / ${Math.round(maxDurationMs / 1000)}s`
          : ` ${Math.ceil(elapsedMs / 1000)}s`
        : '';
    return (
      <button type="button" className="primary" onClick={onStop}>
        ● Recording…{elapsedLabel} (tap to stop)
      </button>
    );
  }
  return (
    <button type="button" className="primary" disabled={disabled || isRequestingMic} onClick={onStart}>
      {isRequestingMic ? 'Requesting mic…' : idleLabel}
    </button>
  );
}
