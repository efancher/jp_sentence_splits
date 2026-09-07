import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { RecordToggleButton } from '../components/RecordToggleButton';
import { SentencePitchAccentText } from '../components/SentencePitchAccentText';
import {
  getPitchAccentDrillSentences,
  getPitchAccentDrillWords,
  type PitchAccentDrillWord,
} from '../db/repository';
import type { Sentence } from '../domain/types';
import { useShadowing } from '../hooks/useShadowing';
import { alignAudio } from '../lib/analysisApi';
import { extractPitch } from '../lib/pitch';
import {
  buildLearnerPitchAccentShapes,
  buildPitchAccentShapeObservations,
  type PitchAccentTarget,
} from '../lib/pitchAccentObservations';
import type { MoraPitchClass } from '../lib/pitchAccentShape';
import type { SentencePitchAccentTarget } from '../lib/sentencePitchAccent';
import { splitOnSurfaceForm } from '../lib/surfaceForm';
import type { TimingObservation } from '../lib/timingObservations';
import { MAX_RECORDING_DURATION_MS } from '../lib/recording';
import { canonicalizeAudioBuffer, decodeAudioBuffer } from '../lib/waveform';

/**
 * Audio-less pitch-accent production drill (docs/ROADMAP.md). The
 * `pitch_accent` SRS card and the shadowing analysis both need a reference
 * recording; this practices the same skill — say it, get the realized
 * pitch-accent shape scored against the dictionary using only the
 * learner's own forced alignment + pitch (`buildPitchAccentShapeObservations`,
 * never a reference clip) — on the majority of the corpus that has none.
 *
 * Two modes:
 *
 *  - **Full sentence.** A Satori sentence with confirmed, proficient
 *    vocabulary that carries dictionary pitch-accent data and has no
 *    reference recording. The sentence shows with each target word's
 *    dictionary H/L marks; you record it and every realized contour is
 *    scored against its dictionary shape. Your measured per-mora H/L
 *    (`buildLearnerPitchAccentShapes`) renders as a second line under the
 *    dictionary marks.
 *  - **Single words.** One proficient, pitch-carrying word at a time (with
 *    an example sentence for context) — record just the word and get the
 *    same check. Not gated on the example sentence lacking audio: you're
 *    drilling the word in isolation, so the overlap with the audio-gated
 *    `pitch_accent` card doesn't apply, which also makes the pool much
 *    larger.
 *
 * A lightweight practice loop, not SRS: nothing is scheduled or persisted
 * (attempts aren't saved — the point is the immediate feedback), and each
 * list is just walked in reading order.
 */

type DrillMode = 'sentence' | 'word';

type AnalysisState =
  | { status: 'idle' }
  | { status: 'analyzing' }
  | { status: 'unavailable' }
  | {
      status: 'done';
      observations: TimingObservation[];
      /** Learner's own measured per-mora H/L, keyed by surface form — the second line under the dictionary row. */
      learnerClassesBySurface: Map<string, MoraPitchClass[]>;
      /** Accent-bearing target words in the take — the denominator for "measured N of M". */
      scorableCount: number;
    };

async function analyzeRecording(
  blob: Blob,
  transcript: string,
  targets: PitchAccentTarget[],
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
        pitchAccentPositions: target.pitchAccentPositions,
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
  const words = useLiveQuery(() => getPitchAccentDrillWords(), []);
  const [mode, setMode] = useState<DrillMode>('sentence');
  const [position, setPosition] = useState(0);
  const shadowing = useShadowing();
  const { cancelRecording } = shadowing;

  const [pending, setPending] = useState<{ blob: Blob; durationMs: number } | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: 'idle' });

  const list = mode === 'sentence' ? sentences : words;
  const currentSentence = mode === 'sentence' ? sentences?.[position] : undefined;
  const currentWord = mode === 'word' ? words?.[position] : undefined;
  const currentId =
    mode === 'sentence' ? currentSentence?.sentence.id : currentWord?.vocabularyItem.id;

  const transcript =
    mode === 'sentence' ? currentSentence?.sentence.japanese : currentWord?.surfaceForm;

  const analysisTargets = useMemo<PitchAccentTarget[]>(() => {
    if (mode === 'sentence') return currentSentence?.targets ?? [];
    if (!currentWord) return [];
    const { reading, pitchAccentPositions } = currentWord.vocabularyItem;
    if (!pitchAccentPositions?.length) return [];
    return [{ surfaceForm: currentWord.surfaceForm, reading, pitchAccentPositions }];
  }, [mode, currentSentence, currentWord]);

  const contourTargets = useMemo<SentencePitchAccentTarget[]>(
    () =>
      analysisTargets.map((target) => ({
        surfaceForm: target.surfaceForm,
        reading: target.reading,
        pitchAccentPositions: target.pitchAccentPositions,
      })),
    [analysisTargets],
  );

  // Reset the take + feedback whenever the item — or the mode — changes.
  useEffect(() => {
    setPending(null);
    setAnalysis({ status: 'idle' });
    cancelRecording();
  }, [currentId, mode, cancelRecording]);

  // Switching modes walks a different list, so start it from the top.
  useEffect(() => {
    setPosition(0);
  }, [mode]);

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
    if (!pending || !transcript || analysisTargets.length === 0) return;
    let active = true;
    setAnalysis({ status: 'analyzing' });
    void analyzeRecording(pending.blob, transcript, analysisTargets).then((next) => {
      if (active) setAnalysis(next);
    });
    return () => {
      active = false;
    };
  }, [pending, transcript, analysisTargets]);

  const isRecording = shadowing.status === 'recording';
  const isRequestingMic = shadowing.status === 'requesting-mic';
  const learnerClasses =
    analysis.status === 'done' && analysis.learnerClassesBySurface.size > 0
      ? analysis.learnerClassesBySurface
      : undefined;

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
          Say it aloud and get its pitch-accent shape checked against the dictionary — for words
          and Satori sentences that have no reference recording. Nothing here is saved or
          scheduled.
        </p>

        <div className="row" role="group" aria-label="Drill mode">
          <button
            type="button"
            aria-pressed={mode === 'sentence'}
            className={mode === 'sentence' ? undefined : 'ghost'}
            onClick={() => setMode('sentence')}
          >
            Full sentence
          </button>
          <button
            type="button"
            aria-pressed={mode === 'word'}
            className={mode === 'word' ? undefined : 'ghost'}
            onClick={() => setMode('word')}
          >
            Single words
          </button>
        </div>

        {list === undefined ? (
          <p className="muted">Loading…</p>
        ) : list.length === 0 ? (
          mode === 'sentence' ? (
            <p className="muted">
              No eligible sentences yet — this needs a sentence whose confirmed vocabulary has
              dictionary pitch-accent data, no reference audio, and whose words you've already
              reviewed to proficiency.
            </p>
          ) : (
            <p className="muted">
              No eligible words yet — this needs a confirmed word with dictionary pitch-accent
              data that you've already reviewed to proficiency.
            </p>
          )
        ) : position >= list.length ? (
          <>
            <p>
              You've reached the end of the list ({list.length}{' '}
              {mode === 'sentence' ? 'sentences' : 'words'}).
            </p>
            <button type="button" onClick={() => setPosition(0)}>
              Start over
            </button>
          </>
        ) : (
          <>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {position + 1} of {list.length}
            </div>

            {mode === 'sentence' && currentSentence ? (
              <SentencePrompt
                sentence={currentSentence.sentence}
                targets={contourTargets}
                learnerClasses={learnerClasses}
              />
            ) : currentWord ? (
              <WordPrompt
                word={currentWord}
                targets={contourTargets}
                learnerClasses={learnerClasses}
              />
            ) : null}

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
                <PitchAccentFeedback analysis={analysis} />
              </div>
            ) : null}

            <div className="row">
              <button
                type="button"
                disabled={position === 0}
                onClick={() => setPosition(position - 1)}
              >
                Previous
              </button>
              <button type="button" onClick={() => setPosition(position + 1)}>
                {position + 1 >= list.length
                  ? 'Finish'
                  : mode === 'sentence'
                    ? 'Next sentence'
                    : 'Next word'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function MarksCaption({ showLearner }: { showLearner: boolean }) {
  return (
    <span className="muted" style={{ fontSize: '0.8rem' }}>
      {showLearner
        ? 'Marks under each word (and the particles after it): top = dictionary, bottom = your recording (H = high mora, L = low)'
        : 'Marks under each word (and the particles after it) show the dictionary pitch accent (H = high mora, L = low)'}
    </span>
  );
}

/** Full-sentence prompt: the sentence with every target word's dictionary marks. */
function SentencePrompt({
  sentence,
  targets,
  learnerClasses,
}: {
  sentence: Sentence;
  targets: SentencePitchAccentTarget[];
  learnerClasses?: Map<string, MoraPitchClass[]>;
}) {
  return (
    <div className="stack" style={{ gap: '0.35rem' }}>
      <SentencePitchAccentText
        key={sentence.id}
        japanese={sentence.japanese}
        targets={targets}
        learnerClassesBySurface={learnerClasses}
      />
      {sentence.translation ? <div className="muted">{sentence.translation}</div> : null}
      <MarksCaption showLearner={!!learnerClasses} />
    </div>
  );
}

/** Single-word prompt: the word alone with its marks, plus an example sentence for context. */
function WordPrompt({
  word,
  targets,
  learnerClasses,
}: {
  word: PitchAccentDrillWord;
  targets: SentencePitchAccentTarget[];
  learnerClasses?: Map<string, MoraPitchClass[]>;
}) {
  const { vocabularyItem: item, sentence, surfaceForm } = word;
  const [before, marked, after] = splitOnSurfaceForm(sentence.japanese, surfaceForm);
  return (
    <div className="stack" style={{ gap: '0.35rem' }}>
      <SentencePitchAccentText
        key={item.id}
        japanese={surfaceForm}
        targets={targets}
        learnerClassesBySurface={learnerClasses}
      />
      <div className="muted">
        {item.reading}
        {item.meaning ? ` — ${item.meaning}` : ''}
      </div>
      <MarksCaption showLearner={!!learnerClasses} />
      {sentence.japanese ? (
        <div className="muted jp" style={{ fontSize: '0.9rem' }}>
          {before}
          <mark>{marked || surfaceForm}</mark>
          {after}
        </div>
      ) : null}
    </div>
  );
}

/** The pitch-accent read-out after a take — shared by both modes. */
function PitchAccentFeedback({ analysis }: { analysis: AnalysisState }) {
  if (analysis.status === 'analyzing') {
    return <p className="muted">Checking your pitch accent…</p>;
  }
  if (analysis.status === 'unavailable') {
    return (
      <p className="muted">
        Couldn't reach the alignment service, so there's no pitch-accent feedback for this take.
        Try again in a moment.
      </p>
    );
  }
  if (analysis.status !== 'done') return null;

  const { observations, learnerClassesBySurface, scorableCount } = analysis;
  const measured = learnerClassesBySurface.size;

  if (measured === 0) {
    return (
      <p className="muted">
        Couldn't line up any of the target word{scorableCount === 1 ? '' : 's'} in this recording,
        so there's nothing to check. That usually means the alignment split a compound differently,
        or the word was too quiet or rushed to measure — try again a bit slower and clearer.
      </p>
    );
  }
  if (observations.length === 0) {
    return (
      <p>
        No clear pitch-accent mismatch on the{' '}
        {measured === scorableCount ? '' : `${measured} of ${scorableCount} `}
        word{measured === 1 ? '' : 's'} I could measure — nicely done.
      </p>
    );
  }
  return (
    <div className="stack">
      <strong>Pitch accent</strong>
      {measured < scorableCount ? (
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Measured {measured} of {scorableCount} target words this take; the rest couldn't be
          lined up in the recording.
        </p>
      ) : null}
      {observations.map((observation) => (
        <article key={observation.id} className="stack" style={{ gap: 0 }}>
          <span>
            <strong>{observation.confidence} confidence:</strong> {observation.message}
          </span>
          {observation.detail ? <p className="muted">{observation.detail}</p> : null}
        </article>
      ))}
    </div>
  );
}
