import { useEffect, useMemo, useRef, useState } from 'react';
import type { AlignmentResult, SentenceAudio } from '../domain/types';
import { getReferenceAlignment, saveReferenceAlignment, getReferencePitchTrack, saveReferencePitchTrack } from '../db/repository';
import { loadOrComputeAlignment } from '../lib/alignmentCache';
import { loadOrComputeReferencePitch } from '../lib/referencePitchCache';
import { buildNativePractice, nativePitchRuns } from '../lib/nativePitchPractice';
import type { PitchAnalysisPayload } from '../lib/pitch';
import { PlaybackCoordinator, PLAYBACK_SPEEDS } from '../lib/recording';
import { nativeAudioController } from '../lib/nativeAudio';

export function NativePitchPractice({ audio, japanese, disabled, onStart }: {
  audio: SentenceAudio; japanese: string; disabled: boolean; onStart: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <section className="panel stack">
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? 'Close pitch practice' : 'Prepare with the native recording'}
    </button>
    {open ? <Practice key={`${audio.id}:${audio.trimStartMs}:${audio.trimEndMs}`} audio={audio} japanese={japanese} disabled={disabled} onStart={onStart} /> : null}
  </section>;
}

function Practice({ audio, japanese, disabled, onStart }: {
  audio: SentenceAudio; japanese: string; disabled: boolean; onStart: () => void;
}) {
  const [data, setData] = useState<{ alignment: AlignmentResult; pitch: PitchAnalysisPayload }>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState<string>();
  const [selected, setSelected] = useState(-1);
  const [speed, setSpeed] = useState(1);
  const [gap, setGap] = useState(1.5);
  const [phase, setPhase] = useState<'idle' | 'listen' | 'repeat'>('idle');
  const [time, setTime] = useState(-1);
  const el = useRef<HTMLAudioElement>(null);
  const pathScroller = useRef<HTMLDivElement>(null);
  const coordinator = useRef(new PlaybackCoordinator());
  const generation = useRef(0);

  function stop() {
    generation.current += 1;
    coordinator.current.cancel();
    setPhase('idle');
    setTime(-1);
  }

  useEffect(() => {
    let stale = false;
    const player = coordinator.current;
    const objectUrl = URL.createObjectURL(audio.blob);
    setUrl(objectUrl);
    setLoading(true);
    setPhase('idle');
    setTime(-1);
    setData(undefined);
    setError('');
    void Promise.all([
      loadOrComputeAlignment(audio.id, audio.blob, japanese, getReferenceAlignment, saveReferenceAlignment),
      loadOrComputeReferencePitch(audio.id, audio.blob, getReferencePitchTrack, saveReferencePitchTrack),
    ]).then(([alignment, pitch]) => {
      if (stale) return;
      if (alignment && pitch) setData({ alignment, pitch });
      else setError('The recording’s pitch or sound timing is unavailable. You can still use the sentence player below.');
    }).catch(() => {
      if (!stale) setError('Couldn’t load pitch practice. Close and reopen to try again.');
    }).finally(() => { if (!stale) setLoading(false); });
    return () => {
      stale = true;
      generation.current += 1;
      player.cancel();
      URL.revokeObjectURL(objectUrl);
    };
  }, [audio.id, audio.blob, japanese]);

  useEffect(() => { if (disabled) stop(); }, [disabled]);
  useEffect(() => {
    const otherPlayback = (event: Event) => { if (event.target !== el.current) stop(); };
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener('play', otherPlayback, true);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('play', otherPlayback, true);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  useEffect(() => {
    if (phase !== 'listen') return;
    let raf = 0;
    const tick = () => { setTime(el.current?.currentTime ?? -1); raf = requestAnimationFrame(tick); };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const chunks = useMemo(() => data ? buildNativePractice(data.alignment.words, data.pitch) : [], [data]);
  const trimStart = (audio.trimStartMs ?? 0) / 1000;
  const trimEnd = (audio.trimEndMs ?? audio.durationMs) / 1000;
  const visible = chunks.filter(chunk => chunk.start >= trimStart && chunk.end <= trimEnd + 0.03);
  const chosen = selected < 0 ? visible : visible.slice(selected, selected + 1);
  const morae = chosen.flatMap(chunk => chunk.morae);
  const start = chosen[0]?.start ?? 0;
  const end = chosen.at(-1)?.end ?? 0;
  const runs = data ? nativePitchRuns(data.pitch, start, end) : [];
  const values = data?.pitch.frames.filter(f => f.voiced && f.relativeSemitones !== null).map(f => f.relativeSemitones!) ?? [];
  const lo = Math.min(-2, ...values);
  const hi = Math.max(2, ...values);
  const y = (value: number) => 70 - (value - lo) / (hi - lo) * 58;
  const width = Math.max(320, morae.length * 42);
  const x = (i: number) => 21 + i * (width - 42) / Math.max(1, morae.length - 1);
  const timedX = (t: number) => 14 + (t - start) / Math.max(0.001, end - start) * (width - 28);
  const activeIndex = phase === 'listen' ? morae.findIndex(mora => time >= mora.start && time < mora.end) : -1;
  useEffect(() => {
    if (pathScroller.current) pathScroller.current.scrollLeft = 0;
  }, [selected]);
  useEffect(() => {
    const scroller = pathScroller.current;
    if (!scroller || activeIndex < 0) return;
    const position = 21 + activeIndex * (width - 42) / Math.max(1, morae.length - 1);
    if (position < scroller.scrollLeft + 21 || position > scroller.scrollLeft + scroller.clientWidth - 21) {
      scroller.scrollLeft = Math.max(0, position - scroller.clientWidth / 2);
    }
  }, [activeIndex, width, morae.length]);

  async function play(repeat: boolean) {
    if (!el.current || disabled || !chosen.length) return;
    stop();
    onStart();
    nativeAudioController.stop();
    const token = generation.current;
    setError('');
    try {
      await coordinator.current.rehearse(el.current, {
        startMs: Math.max(trimStart, start - 0.04) * 1000,
        endMs: Math.min(trimEnd, end + 0.06) * 1000,
      }, { playbackRate: speed, repeat, gapMs: Math.max(1000, (end - start) / speed * gap * 1000),
        onPhase: next => { if (generation.current === token) { setPhase(next); setTime(-1); } },
      });
    } catch {
      if (generation.current === token) setError('Playback couldn’t start. Tap Listen to try again.');
    } finally {
      if (generation.current === token) { setPhase('idle'); setTime(-1); }
    }
  }

  return <div className="stack" style={{ minWidth: 0 }}>
    <p style={{ margin: 0 }}>Listen, hum the movement, then say the words. When you’re ready, try shadowing below.</p>
    <audio ref={el} src={url} hidden />
    {loading ? <p role="status">Preparing the recording’s pitch and kana…</p> : null}
    {error ? <p role="status">{error}</p> : null}
    {!loading && data && !visible.length ? <p>No complete sound timing is available inside this clip’s trim.</p> : null}
    {visible.length ? <>
      <div className="row" style={{ flexWrap: 'wrap' }} aria-label="Practice chunks">
        <button type="button" aria-pressed={selected === -1} onClick={() => { stop(); setSelected(-1); }}>Whole sentence</button>
        {visible.map((chunk, index) => <button type="button" key={chunk.start} aria-pressed={selected === index}
          onClick={() => { stop(); setSelected(index); }}>{chunk.text}</button>)}
      </div>
      <div ref={pathScroller} style={{ overflowX: 'auto', maxWidth: '100%' }} tabIndex={0} aria-label="Pitch path; scroll for longer sentences">
        <svg width={width} height={116} role="img" aria-label="Native pitch path with kana; dots summarize each mora">
          {morae.map((mora, i) => {
            const active = phase === 'listen' && time >= mora.start && time < mora.end;
            const previous = morae[i - 1];
            const joins = previous && previous.pitch !== null && mora.pitch !== null && mora.start - previous.end < 0.08;
            return <g key={`${mora.start}:${i}`}>
              {active ? <rect x={x(i) - 19} y={0} width={38} height={112} rx={6} fill="var(--accent, #0f6b5c)" opacity={0.18} /> : null}
              {joins ? <line x1={x(i - 1)} y1={y(previous.pitch!)} x2={x(i)} y2={y(mora.pitch!)} stroke="currentColor" strokeWidth={2} /> : null}
              {mora.pitch !== null ? <circle cx={x(i)} cy={y(mora.pitch)} r={4} fill="currentColor" />
                : <text x={x(i)} y={65} textAnchor="middle" fill="currentColor">·</text>}
              <text x={x(i)} y={100} textAnchor="middle" fill="currentColor" fontSize={18}>{mora.kana}</text>
            </g>;
          })}
        </svg>
      </div>
      <small className="muted">Dot height follows this recording. Kana are evenly spaced for reading; highlighting follows the audio. · = no reliable pitch target.</small>
      <small className="muted">Practice chunks follow pauses in the recording.</small>
      {chosen.some(chunk => chunk.incomplete) ? <small className="muted">Some sounds could not be separated; those words are shown together.</small> : null}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" disabled={disabled} onClick={() => void play(false)}>Listen</button>
        <button type="button" disabled={disabled} onClick={() => void play(true)}>Listen → repeat</button>
        <button type="button" disabled={phase === 'idle'} onClick={stop}>Stop</button>
        <label>Speed <select value={speed} onChange={e => { stop(); setSpeed(Number(e.target.value)); }}>
          {PLAYBACK_SPEEDS.map(value => <option key={value} value={value}>{value}×</option>)}
        </select></label>
        <label>Time to repeat <select value={gap} onChange={e => { stop(); setGap(Number(e.target.value)); }}>
          <option value={1}>Same as audio</option><option value={1.5}>A little longer</option><option value={2}>Twice as long</option>
        </select></label>
      </div>
      <span role="status">{phase === 'listen' ? 'Listen…' : phase === 'repeat' ? 'Your turn — hum or say it.' : 'Choose a chunk or practice the whole sentence.'}</span>
      <details>
        <summary>Recording detail</summary>
        <div style={{ overflowX: 'auto' }} tabIndex={0}>
          <svg width={width} height={120} role="img" aria-label="Recorded pitch on the actual time axis with mora boundaries">
            {morae.map((mora, i) => <g key={i}>
              <line x1={timedX(mora.start)} x2={timedX(mora.start)} y1={0} y2={80} stroke="currentColor" opacity={0.2} />
              <text x={timedX((mora.start + mora.end) / 2)} y={102} textAnchor="middle" fill="currentColor" fontSize={12}>{mora.kana}</text>
            </g>)}
            {runs.map((run, i) => <polyline key={i} points={run.map(p => `${timedX(p.time)},${y(p.pitch)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth={1.5} />)}
            {phase === 'listen' && time >= start && time <= end ? <line x1={timedX(time)} x2={timedX(time)} y1={0} y2={110} stroke="var(--accent, #0f6b5c)" strokeWidth={2} /> : null}
          </svg>
        </div>
        <small className="muted">Actual durations. Breaks in the curve mean no measurable pitch. Timing and pitch are automatic estimates.</small>
      </details>
    </> : null}
  </div>;
}
