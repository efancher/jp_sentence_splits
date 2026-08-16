import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { AnalysisPanel } from '../components/AnalysisPanel';
import { LiveShadowWaveform } from '../components/LiveShadowWaveform';
import {
  deleteAttempt,
  getDb,
  listAttemptsForSentence,
  rateAttempt,
  saveAttempt,
} from '../db/repository';
import type { Attempt, AttemptRating } from '../domain/types';
import { useShadowing } from '../hooks/useShadowing';
import {
  MAX_RECORDING_DURATION_MS,
  PLAYBACK_SPEEDS,
  PlaybackCoordinator,
  RecordingService,
  calibrateMicrophone,
  type CalibrationResult,
  type TimeRangeMs,
} from '../lib/recording';

const RATINGS: { value: AttemptRating; label: string }[] = [
  { value: 'better', label: 'Better' },
  { value: 'same', label: 'Same' },
  { value: 'worse', label: 'Worse' },
  { value: 'unsure', label: 'Unsure' },
];

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function SpeedControl({
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
        {PLAYBACK_SPEEDS.map((value) => (
          <option key={value} value={value}>
            {value === 1 ? '1× (normal)' : `${value}×`}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ShadowPage() {
  const { bookId = '', sentenceId = '' } = useParams();
  const shadowing = useShadowing();
  const { stopComparison, cancelRecording } = shadowing;

  const [pendingAttempt, setPendingAttempt] = useState<
    { blob: Blob; durationMs: number } | null
  >(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [targetRange, setTargetRange] = useState<TimeRangeMs | null>(null);
  const [isLoopingTarget, setIsLoopingTarget] = useState(false);
  const [shadowMode, setShadowMode] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [analyzingAttemptId, setAnalyzingAttemptId] = useState<string | null>(null);

  const referenceAudioRef = useRef<HTMLAudioElement | null>(null);
  const attemptAudioRef = useRef<HTMLAudioElement | null>(null);
  const targetLoopCoordinator = useRef(new PlaybackCoordinator());

  const data = useLiveQuery(async () => {
    const db = getDb();
    const [book, sentence, sentenceAudio, attempts] = await Promise.all([
      db.books.get(bookId),
      db.sentences.get(sentenceId),
      db.sentenceAudio.where('sentenceId').equals(sentenceId).toArray(),
      listAttemptsForSentence(sentenceId),
    ]);
    const matchingSourceId = book?.sourceKey?.startsWith('shadowing:')
      ? book.sourceKey.slice('shadowing:'.length)
      : undefined;
    const referenceAudio =
      sentenceAudio.find((audio) => audio.sourceId === matchingSourceId) ??
      sentenceAudio[0];
    return { book, sentence, referenceAudio, attempts };
  }, [bookId, sentenceId]);

  // Pick up recordings that finished either by the Stop button or by hitting
  // the max-duration auto-stop (both land in shadowing.lastRecording).
  useEffect(() => {
    if (shadowing.status === 'stopped' && shadowing.lastRecording) {
      setPendingAttempt(shadowing.lastRecording);
    }
  }, [shadowing.status, shadowing.lastRecording]);

  useEffect(() => {
    if (!pendingAttempt) {
      setPendingUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingAttempt.blob);
    setPendingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingAttempt]);

  useEffect(() => {
    if (!data?.referenceAudio) {
      setReferenceUrl(null);
      return;
    }
    const url = URL.createObjectURL(data.referenceAudio.blob);
    setReferenceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [data?.referenceAudio]);

  useEffect(() => {
    setPendingAttempt(null);
    setTargetRange(null);
    setAnalyzingAttemptId(null);
  }, [sentenceId]);

  useEffect(() => {
    if (!referenceAudioRef.current) return;
    referenceAudioRef.current.playbackRate = speed;
    referenceAudioRef.current.preservesPitch = true;
  }, [speed, referenceUrl]);

  // Stop any in-flight recording/comparison/target-loop when leaving this sentence.
  useEffect(
    () => () => {
      stopComparison();
      cancelRecording();
      targetLoopCoordinator.current.cancel();
    },
    [sentenceId, stopComparison, cancelRecording],
  );

  if (!data?.sentence) return <p className="muted">Loading…</p>;

  const { book, sentence, referenceAudio, attempts } = data;

  async function handleSave() {
    if (!pendingAttempt) return;
    setSaveError(null);
    try {
      await saveAttempt({
        sentenceId,
        blob: pendingAttempt.blob,
        mimeType: RecordingService.supportedMimeType() ?? pendingAttempt.blob.type,
        durationMs: pendingAttempt.durationMs,
      });
      setPendingAttempt(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save attempt.');
    }
  }

  async function handleAlternate(attempt: Attempt) {
    if (!referenceAudioRef.current || !attemptAudioRef.current) return;
    targetLoopCoordinator.current.cancel();
    const attemptUrl = URL.createObjectURL(attempt.blob);
    attemptAudioRef.current.src = attemptUrl;
    setActiveAttemptId(attempt.id);
    try {
      await shadowing.playAlternate(
        referenceAudioRef.current,
        attemptAudioRef.current,
        attempt.id,
        speed,
        targetRange ?? undefined,
      );
    } finally {
      URL.revokeObjectURL(attemptUrl);
      setActiveAttemptId(null);
    }
  }

  async function handleDualEar(attempt: Attempt) {
    if (!referenceAudio) return;
    targetLoopCoordinator.current.cancel();
    setActiveAttemptId(attempt.id);
    try {
      await shadowing.playDualEar(referenceAudio.blob, attempt.blob, attempt.id, {
        playbackRate: speed,
        referenceRange: targetRange ?? undefined,
      });
    } finally {
      setActiveAttemptId(null);
    }
  }

  function handleMarkStart() {
    const audio = referenceAudioRef.current;
    if (!audio) return;
    const startMs = Math.round(audio.currentTime * 1000);
    setTargetRange((prev) => ({ startMs, endMs: prev?.endMs ?? startMs }));
  }

  function handleMarkEnd() {
    const audio = referenceAudioRef.current;
    if (!audio) return;
    const endMs = Math.round(audio.currentTime * 1000);
    setTargetRange((prev) => ({ startMs: prev?.startMs ?? 0, endMs }));
  }

  function handleClearTarget() {
    targetLoopCoordinator.current.cancel();
    setTargetRange(null);
  }

  async function handleToggleTargetLoop() {
    if (isLoopingTarget) {
      targetLoopCoordinator.current.cancel();
      return;
    }
    if (!targetRange || !referenceAudioRef.current) return;
    stopComparison();
    setIsLoopingTarget(true);
    try {
      await targetLoopCoordinator.current.loopRange(
        referenceAudioRef.current,
        targetRange,
        speed,
      );
    } finally {
      setIsLoopingTarget(false);
    }
  }

  async function handleCalibrate() {
    setCalibrating(true);
    setCalibrationError(null);
    try {
      setCalibration(await calibrateMicrophone());
    } catch (error) {
      setCalibrationError(
        error instanceof Error ? error.message : 'Unable to calibrate microphone.',
      );
    } finally {
      setCalibrating(false);
    }
  }

  async function handleDelete(attemptId: string) {
    const ok = window.confirm(
      'Delete this shadowing attempt? This cannot be undone.',
    );
    if (!ok) return;
    if (activeAttemptId === attemptId) shadowing.stopComparison();
    await deleteAttempt(attemptId);
  }

  const isRecording = shadowing.status === 'recording';
  const isRequestingMic = shadowing.status === 'requesting-mic';

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="muted">{book?.title} · Shadow</div>
          </div>
          <Link to={`/books/${bookId}/practice/${sentenceId}`}>
            <button type="button">Back to Practice</button>
          </Link>
        </div>

        <div className="row" style={{ alignItems: 'center' }}>
          <div className="jp jp-lg" style={{ flex: 1 }}>
            {sentence.japanese}
          </div>
        </div>
        {!referenceAudio || !referenceUrl ? (
          <p className="muted">
            No reference audio for this sentence yet — import one from
            Practice. You can still record and save shadowing attempts.
          </p>
        ) : (
          <div className="stack">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio
              ref={referenceAudioRef}
              controls
              src={referenceUrl}
              aria-label="Reference audio"
              className="audio-player"
            />
            <SpeedControl speed={speed} onChange={setSpeed} />
            <div className="row" style={{ alignItems: 'center' }}>
              <button type="button" onClick={handleMarkStart}>
                Mark start
              </button>
              <button type="button" onClick={handleMarkEnd}>
                Mark end
              </button>
              {targetRange ? (
                <>
                  <span className="muted">
                    Target: {formatDuration(targetRange.startMs)}–
                    {formatDuration(targetRange.endMs)}
                  </span>
                  <button
                    type="button"
                    disabled={!isLoopingTarget && targetRange.endMs <= targetRange.startMs}
                    onClick={() => void handleToggleTargetLoop()}
                  >
                    {isLoopingTarget ? 'Stop loop' : 'Loop target'}
                  </button>
                  <button type="button" onClick={handleClearTarget}>
                    Clear target
                  </button>
                </>
              ) : null}
            </div>
          </div>
        )}

        <div className="row" style={{ alignItems: 'center' }}>
          <label className="row" style={{ alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={shadowMode}
              disabled={!referenceAudio || isRecording || isRequestingMic}
              onChange={(event) => setShadowMode(event.target.checked)}
            />
            Shadow mode (play reference while recording)
          </label>
          <button
            type="button"
            disabled={calibrating || isRecording || isRequestingMic}
            onClick={() => void handleCalibrate()}
          >
            {calibrating ? 'Calibrating…' : 'Calibrate mic'}
          </button>
        </div>
        {calibration ? (
          <ul className="stack" style={{ margin: 0 }}>
            {calibration.guidance.map((line) => (
              <li key={line} className="muted">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
        {calibrationError ? <p className="muted">{calibrationError}</p> : null}

        <div className="row" style={{ alignItems: 'center' }}>
          <button
            type="button"
            className="primary"
            disabled={isRecording || isRequestingMic}
            onClick={() =>
              void shadowing.startRecording(
                shadowMode && referenceAudio ? 'shadow' : undefined,
                shadowMode && referenceAudio
                  ? { blob: referenceAudio.blob, playbackRate: speed }
                  : undefined,
              )
            }
          >
            {isRequestingMic ? 'Requesting mic…' : 'Record'}
          </button>
          {isRecording ? (
            <>
              <span className="muted">
                {Math.ceil(shadowing.recordingElapsedMs / 1000)}s /{' '}
                {MAX_RECORDING_DURATION_MS / 1000}s
              </span>
              <button
                type="button"
                onClick={() => void shadowing.stopRecording()}
              >
                Stop
              </button>
            </>
          ) : null}
        </div>
        {shadowing.error ? <p className="muted">{shadowing.error}</p> : null}

        {isRecording && shadowing.shadowActive && referenceAudio ? (
          <LiveShadowWaveform
            referenceBlob={referenceAudio.blob}
            active={isRecording && shadowing.shadowActive}
            getMediaTime={shadowing.getShadowMediaTime}
            analyser={shadowing.getShadowAnalyser()}
            sampleRate={shadowing.getShadowSampleRate()}
          />
        ) : null}

        {pendingAttempt && pendingUrl ? (
          <div className="row" style={{ alignItems: 'center' }}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls src={pendingUrl} />
            <button type="button" onClick={() => void handleSave()}>
              Save attempt
            </button>
            <button type="button" onClick={() => setPendingAttempt(null)}>
              Discard
            </button>
          </div>
        ) : null}
        {saveError ? <p className="muted">{saveError}</p> : null}

        <div className="stack">
          <strong>Past attempts</strong>
          {attempts.length === 0 ? (
            <p className="muted">No shadowing attempts recorded yet.</p>
          ) : (
            <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
              {attempts.map((attempt) => (
                <li key={attempt.id} className="stack">
                  <div
                    className="row"
                    style={{ justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <div>
                      <div>{new Date(attempt.createdAt).toLocaleString()}</div>
                      <div className="muted">
                        {formatDuration(attempt.durationMs)}
                        {attempt.manualRating ? ` · ${attempt.manualRating}` : ''}
                      </div>
                    </div>
                    <div className="row">
                      <button
                        type="button"
                        disabled={!referenceAudio}
                        onClick={() => void handleAlternate(attempt)}
                      >
                        {shadowing.comparison?.mode === 'alternate' &&
                        shadowing.comparison.attemptId === attempt.id
                          ? 'Playing…'
                          : 'Alternate'}
                      </button>
                      <button
                        type="button"
                        disabled={!referenceAudio}
                        onClick={() => void handleDualEar(attempt)}
                      >
                        {shadowing.comparison?.mode === 'dualEar' &&
                        shadowing.comparison.attemptId === attempt.id
                          ? 'Playing…'
                          : 'Dual-ear'}
                      </button>
                      <button
                        type="button"
                        disabled={!referenceAudio}
                        className={analyzingAttemptId === attempt.id ? 'primary' : undefined}
                        aria-pressed={analyzingAttemptId === attempt.id}
                        onClick={() =>
                          setAnalyzingAttemptId((current) =>
                            current === attempt.id ? null : attempt.id,
                          )
                        }
                      >
                        {analyzingAttemptId === attempt.id ? 'Close analysis' : 'Analyze'}
                      </button>
                      {RATINGS.map((rating) => (
                        <button
                          key={rating.value}
                          type="button"
                          className={
                            attempt.manualRating === rating.value ? 'primary' : undefined
                          }
                          aria-pressed={attempt.manualRating === rating.value}
                          onClick={() => void rateAttempt(attempt.id, rating.value)}
                        >
                          {rating.label}
                        </button>
                      ))}
                      <button type="button" onClick={() => void handleDelete(attempt.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                  {analyzingAttemptId === attempt.id && referenceAudio ? (
                    <AnalysisPanel
                      referenceBlob={referenceAudio.blob}
                      learnerBlob={attempt.blob}
                      hasReading={Boolean(sentence.readingOnly || sentence.inlineReading)}
                      durationHintSeconds={attempt.durationMs / 1000}
                      targetRange={targetRange ?? undefined}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Hidden player used only for Alternate playback's attempt side,
            which needs a real HTMLAudioElement reference (see
            PlaybackCoordinator.alternate). The reference side reuses the
            visible player above. */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio ref={attemptAudioRef} aria-label="Attempt audio" hidden />
      </section>
    </div>
  );
}
