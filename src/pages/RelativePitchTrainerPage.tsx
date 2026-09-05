import { useEffect, useRef, useState } from 'react';

/**
 * Plain interval/direction ear trainer (up/down/same), decoupled from any
 * mora/drop-position framing. Diagnostic companion to PitchEarTrainerPage:
 * if this stays easy even at a small interval, the pitch-accent bottleneck
 * is the Japanese-specific layer (voicing, speech tempo, unfamiliar mora
 * timing) rather than relative pitch itself. Ported from
 * scripts/relative-pitch-trainer.html; nothing here is saved or scheduled.
 */

type Direction = 'up' | 'down' | 'same';

interface Pair {
  firstSemitones: number;
  secondSemitones: number;
  answer: Direction;
}

const INTERVALS = [1, 2, 4, 7, 12];

const MANUAL_INTERVAL_OPTIONS = [
  { value: 12, label: '12 — easy (octave)' },
  { value: 7, label: '7 — easier (fifth)' },
  { value: 4, label: '4 (major third)' },
  { value: 2, label: '2 (whole step)' },
  { value: 1, label: '1 — hard (half step)' },
];

const NOTE_LENGTH_OPTIONS = [
  { value: 500, label: '500 (slow)' },
  { value: 300, label: '300' },
  { value: 150, label: '150 (fast)' },
];

function semitoneToFreq(base: number, semitones: number): number {
  return base * Math.pow(2, semitones / 12);
}

function playTone(context: AudioContext, freq: number, startTime: number, durationSec: number): void {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const fade = Math.min(0.02, durationSec / 4);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.3, startTime + fade);
  gain.gain.setValueAtTime(0.3, startTime + durationSec - fade);
  gain.gain.linearRampToValueAtTime(0, startTime + durationSec);
  osc.connect(gain);
  gain.connect(context.destination);
  osc.start(startTime);
  osc.stop(startTime + durationSec);
}

function buildPair(interval: number, includeSame: boolean): Pair {
  const options: Direction[] = includeSame ? ['up', 'down', 'same'] : ['up', 'down'];
  const answer = options[Math.floor(Math.random() * options.length)];
  const secondSemitones = answer === 'up' ? interval : answer === 'down' ? -interval : 0;
  return { firstSemitones: 0, secondSemitones, answer };
}

export function RelativePitchTrainerPage() {
  const [manualInterval, setManualInterval] = useState(4);
  const [noteLength, setNoteLength] = useState(300);
  const [includeSame, setIncludeSame] = useState(true);
  const [adaptive, setAdaptive] = useState(true);
  const [adaptiveIndex, setAdaptiveIndex] = useState(INTERVALS.indexOf(4));

  const [pair, setPair] = useState<Pair | null>(null);
  const [answered, setAnswered] = useState(false);
  const [chosen, setChosen] = useState<Direction | null>(null);
  const [score, setScore] = useState({ correct: 0, total: 0, streak: 0 });
  const [streakNote, setStreakNote] = useState('');

  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      void audioContextRef.current?.close().catch(() => undefined);
    };
  }, []);

  async function ensureAudioContext(): Promise<AudioContext> {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    const context = audioContextRef.current;
    if (context.state === 'suspended') await context.resume();
    return context;
  }

  function activeInterval(): number {
    return adaptive ? INTERVALS[adaptiveIndex] : manualInterval;
  }

  async function playPair(p: Pair): Promise<void> {
    const context = await ensureAudioContext();
    const baseFreq = 220 + Math.random() * 60;
    const durationSec = noteLength / 1000;
    const gapSec = durationSec * 0.5;
    const startTime = context.currentTime + 0.05;
    playTone(context, semitoneToFreq(baseFreq, p.firstSemitones), startTime, durationSec);
    playTone(
      context,
      semitoneToFreq(baseFreq, p.secondSemitones),
      startTime + durationSec + gapSec,
      durationSec,
    );
  }

  async function newTrial(): Promise<void> {
    const next = buildPair(activeInterval(), includeSame);
    setPair(next);
    setAnswered(false);
    setChosen(null);
    setStreakNote('');
    await playPair(next);
  }

  async function replay(): Promise<void> {
    if (pair) await playPair(pair);
  }

  function handleAnswer(choice: Direction): void {
    if (!pair || answered) return;
    setAnswered(true);
    setChosen(choice);
    const isCorrect = choice === pair.answer;
    const nextStreak = isCorrect ? score.streak + 1 : 0;
    setScore({
      correct: score.correct + (isCorrect ? 1 : 0),
      total: score.total + 1,
      streak: nextStreak,
    });
    if (adaptive) {
      if (isCorrect && nextStreak > 0 && nextStreak % 5 === 0 && adaptiveIndex > 0) {
        const nextIndex = adaptiveIndex - 1;
        setAdaptiveIndex(nextIndex);
        setStreakNote(`Streak of ${nextStreak} — shrinking interval to ${INTERVALS[nextIndex]} semitones`);
      } else if (!isCorrect && adaptiveIndex < INTERVALS.length - 1) {
        const nextIndex = adaptiveIndex + 1;
        setAdaptiveIndex(nextIndex);
        setStreakNote(`Missed — widening interval back to ${INTERVALS[nextIndex]} semitones`);
      }
    }
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Relative pitch trainer</h2>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          No Japanese, no mora structure — just "did the pitch go up, down, or stay the same."
          This is the raw perceptual substrate under pitch accent. If this stays easy even at a
          small interval, the pitch accent bottleneck is the Japanese-specific layer (voicing,
          speech tempo, unfamiliar mora timing), not relative pitch itself — the Pitch ear
          trainer is the better one to drill. If this is shaky, drill here first; it should
          transfer.
        </p>

        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <label>
            Interval (semitones)
            <select
              value={manualInterval}
              disabled={adaptive}
              onChange={(event) => setManualInterval(Number(event.target.value))}
            >
              {MANUAL_INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Note length (ms)
            <select value={noteLength} onChange={(event) => setNoteLength(Number(event.target.value))}>
              {NOTE_LENGTH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="row" style={{ alignItems: 'center', gap: '0.35rem' }}>
            <input
              type="checkbox"
              checked={includeSame}
              onChange={(event) => setIncludeSame(event.target.checked)}
            />
            Include "same" trials
          </label>
          <label className="row" style={{ alignItems: 'center', gap: '0.35rem' }}>
            <input
              type="checkbox"
              checked={adaptive}
              onChange={(event) => setAdaptive(event.target.checked)}
            />
            Adaptive difficulty
          </label>
        </div>

        <div className="row">
          <button type="button" onClick={() => void newTrial()}>
            ▶ Play pair
          </button>
          <button type="button" disabled={!pair} onClick={() => void replay()}>
            ↻ Replay
          </button>
        </div>

        <div className="row">
          {(includeSame ? (['up', 'same', 'down'] as const) : (['up', 'down'] as const)).map((choice) => {
            const isCorrectChoice = answered && choice === pair?.answer;
            const isWrongChoice = answered && chosen === choice && choice !== pair?.answer;
            return (
              <button
                key={choice}
                type="button"
                disabled={!pair || answered}
                onClick={() => handleAnswer(choice)}
                style={{
                  flex: 1,
                  background: isCorrectChoice ? '#2b5d34' : isWrongChoice ? '#6b2b2b' : undefined,
                  borderColor: isCorrectChoice ? '#3a7d46' : isWrongChoice ? '#8a3a3a' : undefined,
                }}
              >
                {choice === 'up' ? '▲ Up' : choice === 'down' ? '▼ Down' : '— Same'}
              </button>
            );
          })}
        </div>

        {answered ? (
          <p style={{ margin: 0 }}>
            {chosen === pair?.answer ? '✓ correct' : `✗ wrong — it was "${pair?.answer}"`}
          </p>
        ) : null}
        {streakNote ? (
          <p style={{ margin: 0, color: '#6aa9ff', fontSize: '0.85rem' }}>{streakNote}</p>
        ) : null}

        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Score: {score.correct} / {score.total} — streak: {score.streak}
        </p>
      </section>
    </div>
  );
}
