import { useEffect, useRef, useState } from 'react';

/**
 * Standalone tone-only ear trainer for the perceptual skill behind pitch
 * accent: hearing where a pitch sequence drops. No vocabulary or reading
 * involved -- same task shape as the pitch_accent review card (pick the
 * downstep position), with the word stripped out so only the contour is
 * left. Ported from scripts/pitch-ear-trainer.html; nothing here is saved
 * or scheduled.
 */

type WaveType = 'sine' | 'triangle';

interface Trial {
  /** Semitone offsets for each tone, including the trailing "particle" tone. */
  sequence: number[];
  dropIndex: number;
}

const NOTE_COUNT_OPTIONS = [2, 3, 4, 5];

const INTERVAL_OPTIONS = [
  { value: 12, label: '12 — easy (octave)' },
  { value: 7, label: '7 — medium (fifth)' },
  { value: 4, label: '4 — realistic-ish (major third)' },
  { value: 2, label: '2 — hard (whole step)' },
];

const NOTE_LENGTH_OPTIONS = [
  { value: 450, label: '450 (slow)' },
  { value: 300, label: '300' },
  { value: 180, label: '180 (fast, speech-like)' },
];

function semitoneToFreq(base: number, semitones: number): number {
  return base * Math.pow(2, semitones / 12);
}

function playTone(
  context: AudioContext,
  freq: number,
  startTime: number,
  durationSec: number,
  type: WaveType,
): void {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = type;
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

function buildTrial(noteCount: number, interval: number): Trial {
  const dropIndex = Math.floor(Math.random() * (noteCount + 1));
  const sequence: number[] = [];
  for (let i = 0; i < noteCount; i++) {
    sequence.push(dropIndex === 0 || i < dropIndex ? interval : 0);
  }
  // Trailing "particle" tone -- without it, dropIndex === 0 (flat) and
  // dropIndex === noteCount (drop right at the end) sound identical: both
  // are all-high across the main notes. This mirrors the real linguistic
  // fact that heiban and odaka words are indistinguishable in isolation;
  // only the following particle tells them apart.
  sequence.push(dropIndex === 0 ? interval : 0);
  return { sequence, dropIndex };
}

export function PitchEarTrainerPage() {
  const [noteCount, setNoteCount] = useState(3);
  const [interval, setInterval] = useState(4);
  const [noteLength, setNoteLength] = useState(300);
  const [waveType, setWaveType] = useState<WaveType>('sine');

  const [trial, setTrial] = useState<Trial | null>(null);
  const [answered, setAnswered] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);
  const [score, setScore] = useState({ correct: 0, total: 0, streak: 0 });

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

  async function playSequence(sequence: number[]): Promise<void> {
    const context = await ensureAudioContext();
    const baseFreq = 220 + Math.random() * 40; // randomized so the base pitch can't be memorized
    const durationSec = noteLength / 1000;
    const gapSec = durationSec * 0.15;
    const startTime = context.currentTime + 0.05;
    sequence.forEach((semitones, i) => {
      const t = startTime + i * (durationSec + gapSec);
      playTone(context, semitoneToFreq(baseFreq, semitones), t, durationSec, waveType);
    });
  }

  async function newTrial(): Promise<void> {
    const next = buildTrial(noteCount, interval);
    setTrial(next);
    setAnswered(false);
    setChosen(null);
    await playSequence(next.sequence);
  }

  async function replay(): Promise<void> {
    if (trial) await playSequence(trial.sequence);
  }

  function handleAnswer(choice: number): void {
    if (!trial || answered) return;
    setAnswered(true);
    setChosen(choice);
    const isCorrect = choice === trial.dropIndex;
    setScore((prev) => ({
      correct: prev.correct + (isCorrect ? 1 : 0),
      total: prev.total + 1,
      streak: isCorrect ? prev.streak + 1 : 0,
    }));
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Pitch ear trainer</h2>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Trains the raw skill behind pitch accent: hearing where a pitch sequence drops. No
          vocabulary, no reading — just tones. Same task shape as the pitch-accent review card
          (pick the downstep position), but with the word stripped out so only the contour is
          left.
        </p>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          You'll hear one extra tone after the main sequence — it stands in for whatever follows
          the word in real speech (e.g. a particle). Without it, "flat" and "drop at the very
          end" would sound identical, which is also true in real Japanese: heiban and odaka
          words are genuinely indistinguishable in isolation, only the following particle tells
          them apart.
        </p>

        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label>
            Notes per trial
            <select value={noteCount} onChange={(event) => setNoteCount(Number(event.target.value))}>
              {NOTE_COUNT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            Interval size (semitones)
            <select value={interval} onChange={(event) => setInterval(Number(event.target.value))}>
              {INTERVAL_OPTIONS.map((opt) => (
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
          <label>
            Tone
            <select value={waveType} onChange={(event) => setWaveType(event.target.value as WaveType)}>
              <option value="sine">sine (pure)</option>
              <option value="triangle">triangle (softer)</option>
            </select>
          </label>
        </div>

        <div className="row">
          <button type="button" onClick={() => void newTrial()}>
            ▶ Play sequence
          </button>
          <button type="button" disabled={!trial} onClick={() => void replay()}>
            ↻ Replay
          </button>
        </div>

        {trial ? (
          <>
            <p style={{ margin: 0 }}>Where does the pitch drop? (0 = flat / no drop, like heiban)</p>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {Array.from({ length: noteCount + 1 }, (_, i) => i).map((i) => {
                const isCorrectChoice = answered && i === trial.dropIndex;
                const isWrongChoice = answered && chosen === i && i !== trial.dropIndex;
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={answered}
                    onClick={() => handleAnswer(i)}
                    style={{
                      flex: '1 0 60px',
                      background: isCorrectChoice ? '#2b5d34' : isWrongChoice ? '#6b2b2b' : undefined,
                      borderColor: isCorrectChoice ? '#3a7d46' : isWrongChoice ? '#8a3a3a' : undefined,
                    }}
                  >
                    {i === 0 ? 'flat' : `drop@${i}`}
                  </button>
                );
              })}
            </div>
            {answered ? (
              <p style={{ margin: 0 }}>
                {chosen === trial.dropIndex
                  ? '✓ correct'
                  : `✗ wrong — it was ${trial.dropIndex === 0 ? 'flat' : `drop@${trial.dropIndex}`}`}
              </p>
            ) : null}
          </>
        ) : null}

        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Score: {score.correct} / {score.total} — streak: {score.streak}
        </p>
      </section>
    </div>
  );
}
