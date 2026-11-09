import { PLAYBACK_SPEEDS } from '../lib/recording';

export function SpeedControl({
  speed,
  onChange,
}: {
  speed: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      Playback speed
      <select value={speed} onChange={(event) => onChange(Number(event.target.value))}>
        {/* A speed set elsewhere (the loop window's slider) can fall between the presets. */}
        {(PLAYBACK_SPEEDS as readonly number[]).includes(speed) ? null : <option value={speed}>{`${speed}×`}</option>}
        {PLAYBACK_SPEEDS.map((value) => (
          <option key={value} value={value}>
            {value === 1 ? '1× (normal)' : `${value}×`}
          </option>
        ))}
      </select>
    </label>
  );
}
