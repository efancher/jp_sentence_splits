import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { PitchChoiceContour } from '../components/PitchChoiceContour';
import { RecordToggleButton } from '../components/RecordToggleButton';
import { SentencePitchAccentText } from '../components/SentencePitchAccentText';
import { getPitchAccentDrillSentences, readSettings } from '../db/repository';
import { useShadowing } from '../hooks/useShadowing';
import { alignAudio } from '../lib/analysisApi';
import { extractPitch } from '../lib/pitch';
import {
  buildLearnerPitchAccentShapes,
  buildPitchAccentShapeObservations,
} from '../lib/pitchAccentObservations';
import { pitchPatternLabel, type MoraPitchClass } from '../lib/pitchAccentShape';
import {
  buildSentencePitchAccents,
  type SentencePitchAccentTarget,
  type SentenceWordAccent,
} from '../lib/sentencePitchAccent';
import { splitOnSurfaceForm } from '../lib/surfaceForm';
import type { TimingObservation } from '../lib/timingObservations';
import { MAX_RECORDING_DURATION_MS } from '../lib/recording';
import { canonicalizeAudioBuffer, decodeAudioBuffer } from '../lib/waveform';

/**
 * Audio-less pitch-accent production drill (docs/ROADMAP.md). The
 * `pitch_accent` SRS card and the shadowing analysis both need a reference
 * recording; this practices the same skill on the majority of the corpus
 * that has none — a Satori sentence with confirmed vocabulary that carries
 * dictionary pitch-accent data.
 *
 * Each sentence runs in two beats:
 *
 *  1. **Predict the drop.** One accent-bearing word is spotlighted in the
 *     otherwise-plain sentence and you pick where *its* pitch falls
 *     (`0..moraCount`, drawn as whole NHK-style contours by
 *     `PitchChoiceContour`) before anything reveals the answer — the
 *     "locate the fall" perceptual step, cued to a single word in real
 *     sentence context rather than an abstract melody (ChatGPT pitch-ear
 *     discussion, 2026-09-06). Skippable when you only want production
 *     practice.
 *  2. **Say it and get it checked.** The full sentence reveals with each
 *     target word's dictionary H/L marks; you record yourself and
 *     `buildPitchAccentShapeObservations` scores each realized contour
 *     against the dictionary shape using only your own forced alignment +
 *     pitch (no reference clip). Your measured per-mora H/L
 *     (`buildLearnerPitchAccentShapes`) renders as a second line under the
 *     dictionary marks, and the spotlighted word's prediction result stays
 *     on screen so the loop closes.
 *
 * A lightweight practice loop, not SRS: nothing is scheduled or persisted
 * (attempts aren't saved — the point is the immediate feedback), and the
 * sentence list is just walked in reading order.
 */

/** Sentinel `prediction` value meaning the learner skipped the predict step. */
const PREDICTION_SKIPPED = -1;

function dropCaption(position: number): string {
  return position === 0 ? 'Stays high (no fall)' : `Falls after mora ${position}`;
}

/** Choice offered on the predict step: 0 (no fall) plus one per mora. */
function focusChoicePositions(moraCount: number): number[] {
  return Array.from({ length: moraCount + 1 }, (_, index) => index);
}

/** Dictionary drop position for the choices — odaka clamped into the word's own span. */
function focusCorrectPosition(word: SentenceWordAccent): number {
  return Math.max(0, Math.min(word.position, word.morae.length));
}

type AnalysisState =
  | { status: 'idle' }
  | { status: 'analyzing' }
  | { status: 'unavailable' }
  | {
      status: 'done';
      observations: TimingObservation[];
      /** Learner's own measured per-mora H/L, keyed by surface form — the second line under the dictionary row. */
      learnerClassesBySurface: Map<string, MoraPitchClass[]>;
      /** Accent-bearing target words in the sentence — the denominator for "measured N of M". */
      scorableCount: number;
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
    return {
      status: 'done',
      observations,
      learnerClassesBySurface,
      scorableCount: scorableTargets.length,
    };
  } catch {
    return { status: 'unavailable' };
  }
}

export function PitchAccentDrillPage() {
  const sentences = useLiveQuery(() => getPitchAccentDrillSentences(), []);
  const quietMode = useLiveQuery(async () => (await readSettings()).quietMode ?? false, []);
  const [position, setPosition] = useState(0);
  const shadowing = useShadowing();
  const { cancelRecording } = shadowing;

  const [pending, setPending] = useState<{ blob: Blob; durationMs: number } | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: 'idle' });
  /** null = not answered yet; PREDICTION_SKIPPED = skipped; else the chosen drop position. */
  const [prediction, setPrediction] = useState<number | null>(null);

  const current = sentences?.[position];
  // Stable per-sentence identity for the pieces below that don't otherwise
  // key off it.
  const currentId = current?.sentence.id;

  useEffect(() => {
    setPending(null);
    setAnalysis({ status: 'idle' });
    setPrediction(null);
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

  // The word to spotlight on the predict step: the sentence's accent-bearing
  // words that could be located, rotated by list position so patterns vary
  // as you walk the drill rather than always hitting the first word.
  const focusWord = useMemo<SentenceWordAccent | undefined>(() => {
    if (!current) return undefined;
    const located = buildSentencePitchAccents(current.sentence.japanese, contourTargets).filter(
      (word) => word.start >= 0 && word.morae.length > 0,
    );
    if (located.length === 0) return undefined;
    return located[position % located.length];
  }, [current, contourTargets, position]);

  const predicted = prediction !== null;
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
          Spot where one word&rsquo;s pitch falls, then say the whole sentence aloud and get its
          pitch-accent shape checked against the dictionary — for Satori sentences that have no
          reference recording. Nothing here is saved or scheduled.
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

            {focusWord && !predicted ? (
              <PredictDropStep
                japanese={current.sentence.japanese}
                translation={current.sentence.translation}
                word={focusWord}
                onPredict={setPrediction}
                allowSkip={!quietMode}
              />
            ) : (
              <>
                <div className="stack" style={{ gap: '0.35rem' }}>
                  <SentencePitchAccentText
                    key={current.sentence.id}
                    japanese={current.sentence.japanese}
                    targets={contourTargets}
                    learnerClassesBySurface={
                      analysis.status === 'done' && analysis.learnerClassesBySurface.size > 0
                        ? analysis.learnerClassesBySurface
                        : undefined
                    }
                  />
                  {current.sentence.translation ? (
                    <div className="muted">{current.sentence.translation}</div>
                  ) : null}
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    {analysis.status === 'done' && analysis.learnerClassesBySurface.size > 0
                      ? 'Marks under each word: top = dictionary, bottom = your recording (H = high mora, L = low)'
                      : 'Marks under each word show the dictionary pitch accent (H = high mora, L = low)'}
                  </span>
                </div>

                {focusWord && prediction !== null && prediction !== PREDICTION_SKIPPED ? (
                  <PredictionResult word={focusWord} predicted={prediction} />
                ) : null}

                {quietMode ? (
                  <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                    Quiet mode is on, so the say-it-aloud step is paused — this runs as a
                    perception-only drill. Move to the next sentence when you&rsquo;re ready.
                  </p>
                ) : (
                  <>
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
                            Couldn't reach the alignment service, so there's no pitch-accent
                            feedback for this take. Try again in a moment.
                          </p>
                        ) : analysis.status === 'done' &&
                          analysis.learnerClassesBySurface.size === 0 ? (
                          <p className="muted">
                            Couldn't line up any of the target word
                            {analysis.scorableCount === 1 ? '' : 's'} in this recording, so there's
                            nothing to check. That usually means the alignment split a compound
                            differently, or the word was too quiet or rushed to measure — try again
                            a bit slower and clearer.
                          </p>
                        ) : analysis.status === 'done' && analysis.observations.length === 0 ? (
                          <p>
                            No clear pitch-accent mismatch on the{' '}
                            {analysis.learnerClassesBySurface.size === analysis.scorableCount
                              ? ''
                              : `${analysis.learnerClassesBySurface.size} of ${analysis.scorableCount} `}
                            word{analysis.learnerClassesBySurface.size === 1 ? '' : 's'} I could
                            measure — nicely done.
                          </p>
                        ) : analysis.status === 'done' ? (
                          <div className="stack">
                            <strong>Pitch accent</strong>
                            {analysis.learnerClassesBySurface.size < analysis.scorableCount ? (
                              <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                                Measured {analysis.learnerClassesBySurface.size} of{' '}
                                {analysis.scorableCount} target words this take; the rest couldn't
                                be lined up in the recording.
                              </p>
                            ) : null}
                            {analysis.observations.map((observation) => (
                              <article key={observation.id} className="stack" style={{ gap: 0 }}>
                                <span>
                                  <strong>{observation.confidence} confidence:</strong>{' '}
                                  {observation.message}
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
                  </>
                )}
              </>
            )}

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

/**
 * Beat 1: pick where the spotlighted word's pitch falls, before the
 * sentence's dictionary marks reveal.
 */
function PredictDropStep({
  japanese,
  translation,
  word,
  onPredict,
  allowSkip,
}: {
  japanese: string;
  translation?: string;
  word: SentenceWordAccent;
  onPredict: (position: number) => void;
  /** Hidden in quiet mode, where the prediction *is* the whole exercise. */
  allowSkip: boolean;
}) {
  const [before, target, after] = splitOnSurfaceForm(japanese, word.surfaceForm);
  return (
    <div className="stack" aria-label="Predict where this word's pitch falls">
      <div className="jp jp-lg">
        {before}
        <mark>{target || word.surfaceForm}</mark>
        {after}
      </div>
      {translation ? <div className="muted">{translation}</div> : null}
      <div className="jp">{word.reading}</div>
      <p style={{ margin: 0 }}>
        Where does <strong className="jp">{word.surfaceForm}</strong>&rsquo;s pitch fall? Say it in
        your head first, then pick the contour.
      </p>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
        {focusChoicePositions(word.morae.length).map((choice) => (
          <button
            key={choice}
            type="button"
            className="pa-choice-button stack"
            style={{ gap: '0.2rem', alignItems: 'center' }}
            onClick={() => onPredict(choice)}
          >
            <PitchChoiceContour morae={word.morae} position={choice} />
            <span className="muted" style={{ fontSize: '0.75rem' }}>
              {dropCaption(choice)}
            </span>
          </button>
        ))}
      </div>
      {allowSkip ? (
        <button
          type="button"
          className="ghost"
          style={{ alignSelf: 'flex-start', fontSize: '0.8rem' }}
          onClick={() => onPredict(PREDICTION_SKIPPED)}
        >
          Skip — just practise saying it
        </button>
      ) : null}
    </div>
  );
}

/** The persistent "you predicted X, dictionary says Y" line after beat 1. */
function PredictionResult({ word, predicted }: { word: SentenceWordAccent; predicted: number }) {
  const correct = focusCorrectPosition(word);
  const hit = predicted === correct;
  const label = pitchPatternLabel(word.position, word.morae.length);
  return (
    <div className="stack" style={{ gap: '0.25rem' }} aria-label="Your pitch-fall prediction">
      <div>
        {hit ? '✓ ' : '✗ '}
        <strong className="jp">{word.surfaceForm}</strong> — you picked{' '}
        <em>{dropCaption(predicted).toLowerCase()}</em>
        {hit ? '' : `; the dictionary has it ${label} (${dropCaption(correct).toLowerCase()})`}.
      </div>
      {hit ? null : (
        <div className="row" style={{ alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: '0.75rem' }}>
            you:
          </span>
          <PitchChoiceContour morae={word.morae} position={predicted} />
          <span className="muted" style={{ fontSize: '0.75rem' }}>
            dictionary:
          </span>
          <PitchChoiceContour morae={word.morae} position={correct} />
        </div>
      )}
    </div>
  );
}
