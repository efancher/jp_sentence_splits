import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { AnalysisPanel } from '../components/AnalysisPanel';
import { LiveShadowWaveform } from '../components/LiveShadowWaveform';
import { RecordToggleButton } from '../components/RecordToggleButton';
import { SyncedShadowText } from '../components/SyncedShadowText';
import {
  deleteAttempt,
  getDb,
  listAttemptAnalysisSummariesForSentence,
  listAttemptsForSentence,
  rateAttempt,
  readSettings,
  recordShadowingEncounter,
  saveAttempt,
  setAttemptFavorite,
  updateSettings,
} from '../db/repository';
import type { Attempt, AttemptRating } from '../domain/types';
import { useShadowing } from '../hooks/useShadowing';
import { getSentenceReadingForMora, segmentIntoMorae, type MoraUnit } from '../lib/mora';
import { buildHistoryDisplay } from '../lib/pronunciationHistory';
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
  const { stopComparison, cancelRecording, updateShadowLoop } = shadowing;

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
  const [calibrating, setCalibrating] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [analyzingAttemptId, setAnalyzingAttemptId] = useState<string | null>(null);
  const [hideTranscript, setHideTranscript] = useState(false);
  const [showMeaningInstead, setShowMeaningInstead] = useState(false);
  const [draftNotes, setDraftNotes] = useState('');
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [shadowEncounterNote, setShadowEncounterNote] = useState(false);
  const referenceRepairAttempted = useRef(false);

  // Close-shadow hands-free rep loop.
  const [isLoopingReps, setIsLoopingReps] = useState(false);
  const [repCount, setRepCount] = useState(0);
  const [ephemeralTake, setEphemeralTake] = useState<{ blob: Blob; durationMs: number } | null>(
    null,
  );
  const [ephemeralUrl, setEphemeralUrl] = useState<string | null>(null);
  /** True from loop start until its final stopped-take has been consumed as an ephemeral rep. */
  const loopEngagedRef = useRef(false);

  const referenceAudioRef = useRef<HTMLAudioElement | null>(null);
  const attemptAudioRef = useRef<HTMLAudioElement | null>(null);
  const ephemeralAudioRef = useRef<HTMLAudioElement | null>(null);
  const targetLoopCoordinator = useRef(new PlaybackCoordinator());

  const quietMode = useLiveQuery(async () => (await readSettings()).quietMode ?? false, []);

  const data = useLiveQuery(async () => {
    const db = getDb();
    const [book, sentence, sentenceAudio, attempts, analysisSummaries] = await Promise.all([
      db.books.get(bookId),
      db.sentences.get(sentenceId),
      db.sentenceAudio.where('sentenceId').equals(sentenceId).toArray(),
      listAttemptsForSentence(sentenceId),
      listAttemptAnalysisSummariesForSentence(sentenceId),
    ]);
    const matchingSourceId = book?.sourceKey?.startsWith('shadowing:')
      ? book.sourceKey.slice('shadowing:'.length)
      : undefined;
    const referenceAudio =
      sentenceAudio.find((audio) => audio.sourceId === matchingSourceId) ??
      sentenceAudio[0];
    return { book, sentence, referenceAudio, attempts, analysisSummaries };
  }, [bookId, sentenceId]);

  /** Valid loop-point range (both marks set, end after start), else null. */
  const loopRange =
    targetRange && targetRange.endMs > targetRange.startMs ? targetRange : null;

  // Pick up recordings that finished either by the Stop button or by hitting
  // the max-duration auto-stop. A just-ended rep loop also lands a final take
  // in `shadowing.lastRecording` — route that to the ephemeral take, not the
  // save/discard pending-attempt slot.
  useEffect(() => {
    if (shadowing.status !== 'stopped' || !shadowing.lastRecording) return;
    if (loopEngagedRef.current) {
      loopEngagedRef.current = false;
      setEphemeralTake(shadowing.lastRecording);
      return;
    }
    setPendingAttempt(shadowing.lastRecording);
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
    if (!ephemeralTake) {
      setEphemeralUrl(null);
      return;
    }
    const url = URL.createObjectURL(ephemeralTake.blob);
    setEphemeralUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [ephemeralTake]);

  // Some browsers (Safari) don't reliably pick up a same-element `src` swap
  // without an explicit `load()`, so a stale rep can keep playing after the
  // next one lands. One render after the `src` prop commits.
  useEffect(() => {
    ephemeralAudioRef.current?.load();
  }, [ephemeralUrl]);

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
    setDraftNotes('');
    setTargetRange(null);
    setAnalyzingAttemptId(null);
    setReferenceError(null);
    setEphemeralTake(null);
    setIsLoopingReps(false);
    setRepCount(0);
    loopEngagedRef.current = false;
    referenceRepairAttempted.current = false;
  }, [sentenceId]);

  /**
   * Safari's IndexedDB occasionally hands back a reference-audio Blob that
   * fails to play (WebKitBlobResource error) even though it looks intact
   * locally. One retry after refetching the clip from Supabase Storage
   * recovers from that without a full book re-import; `db.sentenceAudio`
   * updating retriggers the liveQuery above and swaps in a fresh
   * `referenceUrl` automatically.
   */
  function handleReferenceAudioError() {
    const audioId = data?.referenceAudio?.id;
    if (referenceRepairAttempted.current || !audioId) return;
    referenceRepairAttempted.current = true;
    void (async () => {
      const { repairSentenceAudio } = await import('../sync/audioSync');
      const freshBlob = await repairSentenceAudio(audioId);
      if (!freshBlob) {
        setReferenceError(
          'Could not play this recording on this device. Try re-importing the book.',
        );
      }
    })();
  }

  useEffect(() => {
    if (!referenceAudioRef.current) return;
    referenceAudioRef.current.playbackRate = speed;
    referenceAudioRef.current.preservesPitch = true;
  }, [speed, referenceUrl]);

  // Keep an in-flight rep loop in sync with the live "Playback speed" and
  // "Mark start / Mark end" controls — no stop/restart (which would re-run
  // the gesture-gated audio setup and drop a beat).
  useEffect(() => {
    if (isLoopingReps) updateShadowLoop({ playbackRate: speed });
  }, [speed, isLoopingReps, updateShadowLoop]);

  useEffect(() => {
    if (isLoopingReps) updateShadowLoop({ range: loopRange });
  }, [loopRange, isLoopingReps, updateShadowLoop]);

  // If the loop's mic/audio setup fails, drop back out of the loop UI.
  useEffect(() => {
    if (isLoopingReps && shadowing.status === 'idle' && shadowing.error) {
      loopEngagedRef.current = false;
      setIsLoopingReps(false);
      setRepCount(0);
    }
  }, [isLoopingReps, shadowing.status, shadowing.error]);

  // Stop any in-flight recording/comparison/loop when leaving this sentence.
  useEffect(
    () => () => {
      stopComparison();
      cancelRecording();
      targetLoopCoordinator.current.cancel();
    },
    [sentenceId, stopComparison, cancelRecording],
  );

  const moraUnits = useMemo<MoraUnit[]>(() => {
    const sentence = data?.sentence;
    if (!sentence) return [];
    const chunks = getSentenceReadingForMora(sentence);
    return chunks ? segmentIntoMorae(chunks) : [];
  }, [data?.sentence]);

  if (!data?.sentence) return <p className="muted">Loading…</p>;

  const { book, sentence, referenceAudio, attempts, analysisSummaries } = data;
  const historyByAttemptId = new Map(
    buildHistoryDisplay(analysisSummaries).map((entry) => [entry.summary.id, entry]),
  );

  async function handleSave() {
    if (!pendingAttempt) return;
    setSaveError(null);
    try {
      await saveAttempt({
        sentenceId,
        blob: pendingAttempt.blob,
        mimeType: RecordingService.supportedMimeType() ?? pendingAttempt.blob.type,
        durationMs: pendingAttempt.durationMs,
        notes: draftNotes.trim() || undefined,
        referencePlaybackRate: speed,
      });
      setPendingAttempt(null);
      setDraftNotes('');
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

  function handleToggleRepLoop() {
    if (isLoopingReps) {
      setIsLoopingReps(false);
      setRepCount(0);
      shadowing.stopShadowLoop();
      return;
    }
    if (!referenceAudio) return;
    stopComparison();
    setEphemeralTake(null);
    loopEngagedRef.current = true;
    setIsLoopingReps(true);
    setRepCount(1);
    void shadowing.startShadowLoop(referenceAudio.blob, {
      playbackRate: speed,
      range: loopRange,
      onRep: (take) => {
        setEphemeralTake(take);
        setRepCount((n) => n + 1);
      },
    });
  }

  async function handleHearEphemeral() {
    if (!ephemeralAudioRef.current) return;
    try {
      await ephemeralAudioRef.current.play();
    } catch {
      // best-effort playback
    }
  }

  async function handleCompareEphemeral() {
    const reference = referenceAudioRef.current;
    const learner = ephemeralAudioRef.current;
    if (!reference || !learner) return;
    await shadowing.playAlternate(
      reference,
      learner,
      'ephemeral-take',
      speed,
      targetRange ?? undefined,
    );
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

  async function handleRate(attemptId: string, rating: AttemptRating) {
    await rateAttempt(attemptId, rating);
    // A close shadow of the whole sentence is evidence the learner can read
    // and parse it — feed it to the SRS as one natural encounter on the
    // sentence's reading_in_context card (no-ops when that card doesn't
    // exist yet or an encounter was already counted this cycle).
    if (rating === 'better' || rating === 'same') {
      const recorded = await recordShadowingEncounter(sentenceId);
      setShadowEncounterNote(recorded !== null);
    }
  }

  const isRecording = shadowing.status === 'recording';
  const isRequestingMic = shadowing.status === 'requesting-mic';
  const loopBusy = isLoopingReps || isRequestingMic;

  return (
    <div className="stack">
      {quietMode ? (
        <section className="panel stack" style={{ gap: '0.4rem' }}>
          <strong>Quiet mode is on</strong>
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Shadowing needs you to speak aloud. New sessions skip it while quiet mode is on —
            this page still works if you&rsquo;ve found somewhere you can talk.
          </p>
          <button
            type="button"
            className="ghost"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => void updateSettings({ quietMode: false })}
          >
            Turn off quiet mode
          </button>
        </section>
      ) : null}

      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="muted">{book?.title} · Shadow</div>
          </div>
          <div className="row">
            <button
              type="button"
              onClick={() => setShowMeaningInstead((value) => !value)}
              disabled={!sentence.translation}
            >
              {showMeaningInstead ? 'Show Japanese' : 'Show meaning instead'}
            </button>
            <button type="button" onClick={() => setHideTranscript((value) => !value)}>
              {hideTranscript ? 'Show transcript' : 'Hide transcript'}
            </button>
            <Link to={`/books/${bookId}/practice/${sentenceId}`}>
              <button type="button">Back to Practice</button>
            </Link>
          </div>
        </div>

        <div className="row" style={{ alignItems: 'center' }}>
          {hideTranscript ? (
            <div className="muted" style={{ flex: 1 }}>
              Audio-only practice
            </div>
          ) : showMeaningInstead && sentence.translation ? (
            <div style={{ flex: 1 }}>{sentence.translation}</div>
          ) : (
            <SyncedShadowText
              audioRef={referenceAudioRef}
              referenceAudio={referenceAudio}
              japanese={sentence.japanese}
              moraUnits={moraUnits}
              sentenceId={sentence.id}
            />
          )}
        </div>

        {!referenceAudio || !referenceUrl ? (
          <p className="muted">
            No reference audio for this sentence yet — import one from
            Practice. You can still record and save shadowing attempts below.
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
              onError={handleReferenceAudioError}
            />
            {referenceError ? <p className="muted">{referenceError}</p> : null}
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
            {isLoopingReps ? (
              <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                Adjust without stopping the loop — the target range updates right away, a
                speed change takes effect on the next pass.
              </p>
            ) : null}
          </div>
        )}
      </section>

      {referenceAudio ? (
        <section className="panel stack">
          <strong>Close shadow</strong>
          <p className="muted" style={{ margin: 0 }}>
            Play along and stay as close behind the speaker as you can. Loop it hands-free
            and keep going — nothing here is saved.
          </p>
          <div className="stack" style={{ minHeight: '7rem' }}>
            {isLoopingReps ? (
              <div className="row" style={{ alignItems: 'center' }}>
                <button
                  type="button"
                  className="primary"
                  aria-pressed
                  onClick={handleToggleRepLoop}
                >
                  ⏹ Stop loop
                </button>
                <span className="muted">Rep {repCount} — shadow along…</span>
              </div>
            ) : (
              <button
                type="button"
                disabled={isRecording || isRequestingMic}
                onClick={handleToggleRepLoop}
              >
                🔁 Loop shadow reps (hands-free)
              </button>
            )}
            {isLoopingReps && shadowing.shadowActive ? (
              <LiveShadowWaveform
                referenceBlob={referenceAudio.blob}
                active={isLoopingReps && shadowing.shadowActive}
                getMediaTime={shadowing.getShadowMediaTime}
                analyser={shadowing.getShadowAnalyser()}
                sampleRate={shadowing.getShadowSampleRate()}
              />
            ) : null}
            {ephemeralUrl && !isLoopingReps ? (
              <div className="row" style={{ alignItems: 'center' }}>
                <button type="button" onClick={() => void handleHearEphemeral()}>
                  ▶ Hear that back
                </button>
                <button
                  type="button"
                  disabled={Boolean(shadowing.comparison)}
                  onClick={() => void handleCompareEphemeral()}
                >
                  {shadowing.comparison?.attemptId === 'ephemeral-take'
                    ? 'Playing…'
                    : '🔁 Compare to native'}
                </button>
              </div>
            ) : null}
          </div>
          {isLoopingReps && shadowing.error ? (
            <p className="muted">{shadowing.error}</p>
          ) : null}
        </section>
      ) : null}

      <section className="panel stack">
        <strong>Record &amp; analyze</strong>
        <div className="row" style={{ alignItems: 'center' }}>
          <button
            type="button"
            disabled={calibrating || isRecording || loopBusy}
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
          <RecordToggleButton
            isRecording={isRecording && !isLoopingReps}
            isRequestingMic={isRequestingMic && !isLoopingReps}
            elapsedMs={shadowing.recordingElapsedMs}
            maxDurationMs={MAX_RECORDING_DURATION_MS}
            disabled={loopBusy}
            idleLabel="Record"
            onStart={() => void shadowing.startRecording()}
            onStop={() => void shadowing.stopRecording()}
          />
        </div>
        {shadowing.error && !isLoopingReps ? (
          <p className="muted">{shadowing.error}</p>
        ) : null}

        {pendingAttempt && pendingUrl ? (
          <div className="stack">
            <div className="row" style={{ alignItems: 'center' }}>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls src={pendingUrl} />
            </div>
            <label>
              Notes <span className="muted">(optional)</span>
              <input
                value={draftNotes}
                onChange={(event) => setDraftNotes(event.target.value)}
                placeholder="Focus for next time…"
              />
            </label>
            <div className="row" style={{ alignItems: 'center' }}>
              <button type="button" onClick={() => void handleSave()}>
                Save attempt
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingAttempt(null);
                  setDraftNotes('');
                }}
              >
                Discard
              </button>
            </div>
          </div>
        ) : null}
        {saveError ? <p className="muted">{saveError}</p> : null}

        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong>Past attempts</strong>
            <Link to="/pronunciation" className="muted" style={{ fontSize: '0.85rem' }}>
              Pronunciation profile →
            </Link>
          </div>
          {shadowEncounterNote ? (
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              Counted as a natural encounter with this sentence — its reading review is
              scheduled a little further out.
            </p>
          ) : null}
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
                      <div>
                        {new Date(attempt.createdAt).toLocaleString()}
                        {attempt.isFavorite ? ' ★' : ''}
                      </div>
                      <div className="muted">
                        {formatDuration(attempt.durationMs)}
                        {attempt.manualRating ? ` · ${attempt.manualRating}` : ''}
                      </div>
                      {attempt.notes ? <p className="muted">{attempt.notes}</p> : null}
                      {historyByAttemptId.has(attempt.id) ? (
                        <div className="muted">
                          Timing: {historyByAttemptId.get(attempt.id)!.timingLabel} · Pitch:{' '}
                          {historyByAttemptId.get(attempt.id)!.pitchLabel}
                        </div>
                      ) : null}
                    </div>
                    <div className="row">
                      <button
                        type="button"
                        aria-pressed={Boolean(attempt.isFavorite)}
                        onClick={() =>
                          void setAttemptFavorite(attempt.id, !attempt.isFavorite)
                        }
                      >
                        {attempt.isFavorite ? 'Unfavorite' : 'Favorite'}
                      </button>
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
                          onClick={() => void handleRate(attempt.id, rating.value)}
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
                      sentenceId={sentenceId}
                      referenceAudioId={referenceAudio.id}
                      referenceBlob={referenceAudio.blob}
                      attemptId={attempt.id}
                      attemptCreatedAt={attempt.createdAt}
                      learnerBlob={attempt.blob}
                      transcript={sentence.japanese}
                      moraUnits={moraUnits}
                      hasReading={Boolean(sentence.readingOnly || sentence.inlineReading)}
                      durationHintSeconds={attempt.durationMs / 1000}
                      targetRange={targetRange ?? undefined}
                      referencePlaybackRate={attempt.referencePlaybackRate}
                      onProposeSegment={setTargetRange}
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
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio
          ref={ephemeralAudioRef}
          src={ephemeralUrl ?? undefined}
          aria-label="Close-shadow rep"
          hidden
        />
      </section>
    </div>
  );
}
