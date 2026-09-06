import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { RecordToggleButton } from '../components/RecordToggleButton';
import { SentencePitchAccentRow } from '../components/SentencePitchAccentRow';
import { getPitchAccentDrillSentences } from '../db/repository';
import { useShadowing } from '../hooks/useShadowing';
import { alignAudio } from '../lib/analysisApi';
import { extractPitch } from '../lib/pitch';
import {
  buildLearnerPitchAccentShapes,
  buildPitchAccentShapeObservations,
} from '../lib/pitchAccentObservations';
import type { MoraPitchClass } from '../lib/pitchAccentShape';
import type { SentencePitchAccentTarget } from '../lib/sentencePitchAccent';
import type { TimingObservation } from '../lib/timingObservations';
import { MAX_RECORDING_DURATION_MS } from '../lib/recording';
import { canonicalizeAudioBuffer, decodeAudioBuffer } from '../lib/waveform';

/**
 * Audio-less pitch-accent production drill (docs/ROADMAP.md). The
 * `pitch_accent` SRS card and the shadowing analysis both need a reference
 * recording; this practices the same skill on the majority of the corpus
 * that has none — a Satori sentence with confirmed vocabulary that carries
 * dictionary pitch-accent data. Record yourself saying the sentence, and
 * `buildPitchAccentShapeObservations` scores each target word's realized
 * contour against the dictionary shape using only the learner's own forced
 * alignment + pitch (no reference clip involved). The take's measured
 * per-mora H/L (`buildLearnerPitchAccentShapes`) is also rendered as a
 * second line under the dictionary `SentencePitchAccentRow`, so a
 * correctly-produced accent shows as a match, not just the absence of a
 * mismatch note.
 *
 * A lightweight practice loop, not SRS: nothing is scheduled or persisted
 * (attempts aren't saved — the point is the immediate feedback), and the
 * sentence list is just walked in reading order.
 */

type AnalysisState =
  | { status: 'idle' }
  | { status: 'analyzing' }
  | { status: 'unavailable' }
  | {
      status: 'done';
      observations: TimingObservation[];
      /** Learner's own measured per-mora H/L, keyed by surface form — the second line under the dictionary row. */
      learnerClassesBySurface: Map<string, MoraPitchClass[]>;
    };

async function analyzeRecording(
  blob: Blob,
  transcript: string,
  targets: SentencePitchAccentTarget[],
): Promise<AnalysisState> {
  try {
    const [alignment, pitch] = await Promise.all([
      alignAudio(blob, transcript),
      decodeAudioBuffer(blob).then((buffer) => extractPitch(canonicalizeAudioBuffer(buffer))),
    ]);
    if (!alignment) return { status: 'unavailable' };
    const scorableTargets = targets
      .filter((target) => target.pitchAccentPositions?.length)
      .map((target) => ({
        surfaceForm: target.surfaceForm,
        reading: target.reading,
        pitchAccentPositions: target.pitchAccentPositions!,
      }));
    const observations = buildPitchAccentShapeObservations({
      learnerWords: alignment.words,
      learnerPitch: pitch,
      targets: scorableTargets,
    });
    const learnerClassesBySurface = new Map<string, MoraPitchClass[]>();
    for (const shape of buildLearnerPitchAccentShapes({
      learnerWords: alignment.words,
      learnerPitch: pitch,
      targets: scorableTargets,
    })) {
      learnerClassesBySurface.set(shape.surfaceForm, shape.classes);
    }
    return { status: 'done', observations, learnerClassesBySurface };
  } catch {
    return { status: 'unavailable' };
  }
}

export function PitchAccentDrillPage() {
  const sentences = useLiveQuery(() => getPitchAccentDrillSentences(), []);
  const [position, setPosition] = useState(0);
  const shadowing = useShadowing();
  const { cancelRecording } = shadowing;

  const [pending, setPending] = useState<{ blob: Blob; durationMs: number } | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: 'idle' });

  const current = sentences?.[position];
  // Stable per-sentence identity for the pieces below that don't otherwise
  // key off it.
  const currentId = current?.sentence.id;

  useEffect(() => {
    setPending(null);
    setAnalysis({ status: 'idle' });
    cancelRecording();
  }, [currentId, cancelRecording]);

  useEffect(() => () => cancelRecording(), [cancelRecording]);

  // Pick up a finished recording (Stop button or max-duration auto-stop).
  useEffect(() => {
    if (shadowing.status === 'stopped' && shadowing.lastRecording) {
      setPending(shadowing.lastRecording);
    }
  }, [shadowing.status, shadowing.lastRecording]);

  useEffect(() => {
    if (!pending) {
      setPendingUrl(null);
      return;
    }
    const url = URL.createObjectURL(pending.blob);
    setPendingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pending]);

  useEffect(() => {
    if (!pending || !current) return;
    let active = true;
    setAnalysis({ status: 'analyzing' });
    void analyzeRecording(pending.blob, current.sentence.japanese, current.targets).then((next) => {
      if (active) setAnalysis(next);
    });
    return () => {
      active = false;
    };
  }, [pending, current]);

  const contourTargets = useMemo<SentencePitchAccentTarget[]>(
    () =>
      (current?.targets ?? []).map((target) => ({
        surfaceForm: target.surfaceForm,
        reading: target.reading,
        pitchAccentPositions: target.pitchAccentPositions,
      })),
    [current],
  );

  const isRecording = shadowing.status === 'recording';
  const isRequestingMic = shadowing.status === 'requesting-mic';

  function goTo(next: number) {
    setPosition(next);
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Pitch-accent drill</h2>
          <Link to="/pronunciation" className="muted" style={{ fontSize: '0.85rem' }}>
            Pronunciation profile →
          </Link>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Say each sentence aloud and get its pitch-accent shape checked against the dictionary —
          for Satori sentences that have no reference recording. Nothing here is saved or scheduled.
        </p>

        {sentences === undefined ? (
          <p className="muted">Loading…</p>
        ) : sentences.length === 0 ? (
          <p className="muted">
            No eligible sentences yet — this needs a sentence whose confirmed vocabulary has
            dictionary pitch-accent data, no reference audio, and whose words you've already
            reviewed to proficiency.
          </p>
        ) : !current ? (
          <>
            <p>You've reached the end of the list ({sentences.length} sentences).</p>
            <button type="button" onClick={() => goTo(0)}>
              Start over
            </button>
          </>
        ) : (
          <>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {position + 1} of {sentences.length}
            </div>
            <div className="jp jp-lg">{current.sentence.japanese}</div>
            {current.sentence.translation ? (
              <div className="muted">{current.sentence.translation}</div>
            ) : null}

            <div className="stack" style={{ gap: '0.25rem' }}>
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                {analysis.status === 'done' && analysis.learnerClassesBySurface.size > 0
                  ? 'Pitch-accent contour (top = dictionary, bottom = your recording)'
                  : 'Target contour (dictionary)'}
              </span>
              <SentencePitchAccentRow
                key={current.sentence.id}
                japanese={current.sentence.japanese}
                targets={contourTargets}
                learnerClassesBySurface={
                  analysis.status === 'done' && analysis.learnerClassesBySurface.size > 0
                    ? analysis.learnerClassesBySurface
                    : undefined
                }
              />
            </div>

            <div className="row" style={{ alignItems: 'center' }}>
              <RecordToggleButton
                isRecording={isRecording}
                isRequestingMic={isRequestingMic}
                elapsedMs={shadowing.recordingElapsedMs}
                maxDurationMs={MAX_RECORDING_DURATION_MS}
                idleLabel={pending ? 'Record again' : 'Record'}
                onStart={() => void shadowing.startRecording()}
                onStop={() => void shadowing.stopRecording()}
              />
            </div>
            {shadowing.error ? <p className="muted">{shadowing.error}</p> : null}

            {pending && pendingUrl ? (
              <div className="stack">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio controls src={pendingUrl} />
                {analysis.status === 'analyzing' ? (
                  <p className="muted">Checking your pitch accent…</p>
                ) : analysis.status === 'unavailable' ? (
                  <p className="muted">
                    Couldn't reach the alignment service, so there's no pitch-accent feedback for
                    this take. Try again in a moment.
                  </p>
                ) : analysis.status === 'done' && analysis.observations.length === 0 ? (
                  <p>No clear pitch-accent mismatch detected on this take — nicely done.</p>
                ) : analysis.status === 'done' ? (
                  <div className="stack">
                    <strong>Pitch accent</strong>
                    {analysis.observations.map((observation) => (
                      <article key={observation.id} className="stack" style={{ gap: 0 }}>
                        <span>
                          <strong>{observation.confidence} confidence:</strong> {observation.message}
                        </span>
                        {observation.detail ? (
                          <p className="muted">{observation.detail}</p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="row">
              <button type="button" disabled={position === 0} onClick={() => goTo(position - 1)}>
                Previous
              </button>
              <button type="button" onClick={() => goTo(position + 1)}>
                {position + 1 >= sentences.length ? 'Finish' : 'Next sentence'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
