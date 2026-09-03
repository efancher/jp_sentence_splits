"""In-process job registry and pipeline orchestration.

Single-worker uvicorn process, so a plain module-level dict is safe (no
cross-process state needed — see deploy/README.md). Each job owns a
scratch directory under config.JOBS_ROOT for its downloaded source audio,
subtitle files, and clipped sentence audio; a periodic sweep evicts jobs
older than JOB_TTL_SECONDS regardless of whether the client cleaned up
(e.g. an abandoned browser tab).

The mining pipeline (yt-dlp download, ffmpeg clipping) is blocking I/O, so
it runs on a plain daemon `threading.Thread` per job rather than an
`asyncio.create_task` — a task tied to one request's event loop isn't
guaranteed to keep running once that request finishes (this bit us under
Starlette's TestClient, which doesn't keep a request's loop alive across
calls; a real thread has no such lifetime coupling).
"""

from __future__ import annotations

import base64
import json
import logging
import os
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from app import (
    asr_client,
    clip,
    config,
    exit_node,
    morphology,
    readings,
    resegment,
    source_cache,
    subtitles,
    waveform,
    youtube,
)
from app.models import (
    ClipAudioInfo,
    ClipRequest,
    ClipResponse,
    CommitJobRequest,
    CommitSentence,
    Cue,
    CueOut,
    JobStage,
    JobState,
    JobStatusResponse,
    SourceInfo,
    TranscriptSegment,
    TranscriptSegmentInput,
    TranslatedRow,
)

logger = logging.getLogger("youtube_mining_api.jobs")


class JobNotFoundError(Exception):
    pass


@dataclass
class ClipRecord:
    path: Path
    mime_type: str = "audio/mp4"


@dataclass
class Job:
    id: str
    dir: Path
    url: str = ""
    created_at: float = field(default_factory=time.time)
    # Bumped by every client request (see get_job) — the idle-sweep clock.
    touched_at: float = field(default_factory=time.time)
    # Coarse lifecycle flag the linear review UI polls.
    status: JobState = "pending"
    # Finer, re-runnable pipeline position each wizard panel drives.
    stage: JobStage = "fetching"
    # Human-readable progress line for both UIs. `message_started_at` is
    # bumped every time `message` changes (via `set_message`) so the wizard
    # can show "N min elapsed" during the long transcription step.
    message: str = "Queued…"
    message_started_at: float = field(default_factory=time.time)
    error: str | None = None
    source: SourceInfo | None = None
    is_music: bool = False
    # "asr" | "human-caption" | "auto-caption" | "lyrics" — set in
    # `_fetch_transcript`. `auto-caption` is the degraded path the wizard warns about.
    transcript_source: str | None = None
    # Transcript stage. `raw_cues` keeps Whisper per-word timings (not
    # serialised) for the auto-advance segment pass; `transcript` is the
    # serialisable view the wizard's transcript panel edits.
    raw_cues: list[Cue] = field(default_factory=list)
    transcript: list[TranscriptSegment] = field(default_factory=list)
    # Segment stage.
    cues: list[Cue] = field(default_factory=list)
    # Translate stage.
    english_by_index: dict[int, str] = field(default_factory=dict)
    rows: list[TranslatedRow] = field(default_factory=list)
    source_audio_path: Path | None = None
    clips: dict[str, ClipRecord] = field(default_factory=dict)
    next_sentence_seq: int = 1

    def set_message(self, message: str) -> None:
        """Set the progress line and reset its elapsed-time clock."""
        self.message = message
        self.message_started_at = time.time()

    def touch(self) -> None:
        self.touched_at = time.time()


_JOBS: dict[str, Job] = {}


def _job_dir(job_id: str) -> Path:
    return Path(config.JOBS_ROOT) / job_id


def _checkpoint_dir(job_id: str) -> Path:
    return Path(config.JOBS_ROOT) / "checkpoints" / job_id


def _checkpoint_root() -> Path:
    return Path(config.JOBS_ROOT) / "checkpoints"


def _write_checkpoint(job: Job) -> None:
    """Persist everything needed to resume `job` from another machine (or
    after a process restart / idle sweep) *except* the large source audio,
    which is re-pulled from the persistent per-video cache
    (app/source_cache.py) on demand. Best effort — a checkpoint failure must
    never fail the pipeline."""
    try:
        ckpt = _checkpoint_dir(job.id)
        ckpt.mkdir(parents=True, exist_ok=True)
        state = {
            "id": job.id,
            "url": job.url,
            "created_at": job.created_at,
            "status": job.status,
            "stage": job.stage,
            "message": job.message,
            "error": job.error,
            "is_music": job.is_music,
            "transcript_source": job.transcript_source,
            "next_sentence_seq": job.next_sentence_seq,
            "source": job.source.model_dump() if job.source else None,
            "raw_cues": [c.model_dump() for c in job.raw_cues],
            "transcript": [t.model_dump() for t in job.transcript],
            "cues": [c.model_dump() for c in job.cues],
            "rows": [r.model_dump() for r in job.rows],
            "english_by_index": {
                str(k): v for k, v in job.english_by_index.items()
            },
            "source_audio_path": (
                str(job.source_audio_path) if job.source_audio_path else None
            ),
        }
        tmp = ckpt / "state.json.tmp"
        tmp.write_text(json.dumps(state), encoding="utf-8")
        os.replace(tmp, ckpt / "state.json")
        # The EN/JA subtitle tracks live only in the job's scratch dir; copy
        # them alongside the checkpoint so run_translate still works after
        # that dir is swept.
        subs = job.dir / "subtitles"
        if subs.is_dir():
            dest = ckpt / "subtitles"
            shutil.rmtree(dest, ignore_errors=True)
            shutil.copytree(subs, dest)
    except Exception:  # noqa: BLE001
        logger.warning("Checkpoint write failed for job %s", job.id, exc_info=True)


def _rehydrate(job_id: str) -> Job | None:
    """Rebuild an evicted or never-seen-on-this-process job from its on-disk
    checkpoint, or None if there is no usable checkpoint. The source audio is
    restored from the persistent per-video cache; if that has been evicted
    too, audio-dependent stages re-download it lazily on first use
    (_ensure_source_audio)."""
    state_path = _checkpoint_dir(job_id) / "state.json"
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None

    job_dir = _job_dir(job_id)
    (job_dir / "clips").mkdir(parents=True, exist_ok=True)
    ckpt_subs = _checkpoint_dir(job_id) / "subtitles"
    if ckpt_subs.is_dir() and not (job_dir / "subtitles").is_dir():
        shutil.copytree(ckpt_subs, job_dir / "subtitles")

    job = Job(id=job_id, dir=job_dir, url=state.get("url", ""))
    job.created_at = state.get("created_at", time.time())
    job.status = state.get("status", "ready")
    job.stage = state.get("stage", "ready")
    job.message = state.get("message", "Resumed.")
    job.error = state.get("error")
    job.is_music = state.get("is_music", False)
    job.transcript_source = state.get("transcript_source")
    job.next_sentence_seq = state.get("next_sentence_seq", 1)
    job.source = SourceInfo(**state["source"]) if state.get("source") else None
    job.raw_cues = [Cue(**c) for c in state.get("raw_cues", [])]
    job.transcript = [
        TranscriptSegment(**t) for t in state.get("transcript", [])
    ]
    job.cues = [Cue(**c) for c in state.get("cues", [])]
    job.rows = [TranslatedRow(**r) for r in state.get("rows", [])]
    job.english_by_index = {
        int(k): v for k, v in state.get("english_by_index", {}).items()
    }

    stored_audio = state.get("source_audio_path")
    if stored_audio and Path(stored_audio).is_file():
        job.source_audio_path = Path(stored_audio)
    elif job.source is not None:
        job.source_audio_path = source_cache.get(job.source.videoId)
    return job


def _find_reusable_job(url: str) -> Job | None:
    """An existing non-errored job for the same URL / video, so kicking off
    the same import from a second machine reconnects to the running mine
    instead of starting a duplicate download + transcription."""
    video_id = youtube.extract_video_id(url)
    for job in _JOBS.values():
        if job.status == "error":
            continue
        if job.url == url or (
            video_id and job.source and job.source.videoId == video_id
        ):
            return job
    if not video_id:
        return None
    root = _checkpoint_root()
    if not root.is_dir():
        return None
    for state_path in root.glob("*/state.json"):
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        src = state.get("source")
        if (
            state.get("status") != "error"
            and src
            and src.get("videoId") == video_id
        ):
            rehydrated = _rehydrate(state["id"])
            if rehydrated is not None:
                _JOBS[rehydrated.id] = rehydrated
                return rehydrated
    return None


def create_job(url: str) -> Job:
    existing = _find_reusable_job(url)
    if existing is not None:
        logger.info("Reusing mining job %s for %s", existing.id, url)
        return existing
    job_id = uuid.uuid4().hex[:12]
    job_dir = _job_dir(job_id)
    (job_dir / "clips").mkdir(parents=True, exist_ok=True)
    job = Job(id=job_id, dir=job_dir, url=url)
    _JOBS[job_id] = job
    threading.Thread(target=_run_job, args=(job, url), daemon=True).start()
    return job


def get_job(job_id: str) -> Job:
    job = _JOBS.get(job_id)
    if job is None:
        job = _rehydrate(job_id)
        if job is None:
            raise JobNotFoundError(job_id)
        _JOBS[job_id] = job
        logger.info("Rehydrated mining job %s from checkpoint", job_id)
    job.touch()
    return job


def list_jobs() -> list[Job]:
    """Every resumable job — in memory plus any on-disk checkpoint not
    already loaded — newest first. Powers the wizard's cross-machine resume
    picker. Rehydrated entries are not inserted into `_JOBS`; get_job does
    that on demand."""
    by_id: dict[str, Job] = dict(_JOBS)
    root = _checkpoint_root()
    if root.is_dir():
        for state_path in root.glob("*/state.json"):
            job_id = state_path.parent.name
            if job_id in by_id:
                continue
            rehydrated = _rehydrate(job_id)
            if rehydrated is not None:
                by_id[job_id] = rehydrated
    return sorted(by_id.values(), key=lambda j: j.created_at, reverse=True)


def _ensure_source_audio(job: Job) -> Path:
    """The job's source audio, re-fetching it into the persistent cache if
    both the scratch copy and the cached copy are gone (a resumed job whose
    cache entry was LRU-evicted). Blocking — callers already run in a
    thread."""
    if job.source_audio_path is not None and job.source_audio_path.is_file():
        return job.source_audio_path
    if job.url:
        job.source_audio_path = source_cache.ensure(job.url)
        return job.source_audio_path
    raise ValueError("Job source audio is no longer available")


def delete_job(job_id: str, *, keep_checkpoint: bool = False) -> None:
    job = _JOBS.pop(job_id, None)
    shutil.rmtree(job.dir if job is not None else _job_dir(job_id), ignore_errors=True)
    if not keep_checkpoint:
        shutil.rmtree(_checkpoint_dir(job_id), ignore_errors=True)


_SENTENCE_END_CHARS = "。｡．.！!？?…」』"


def _terminal_punct_ratio(cues: list[Cue]) -> float:
    if not cues:
        return 0.0
    ending = sum(
        1 for cue in cues if cue.text.rstrip()[-1:] in _SENTENCE_END_CHARS
    )
    return ending / len(cues)


def _looks_human_captioned(cues: list[Cue]) -> bool:
    """True when the JA caption track looks human-authored, not YouTube's
    auto-captions — the latter carry no sentence-final punctuation at all,
    a real track ends most cues on it. Used to skip ASR when good subs
    already exist."""
    return len(cues) >= 5 and _terminal_punct_ratio(cues) >= 0.5


def _run_job(job: Job, url: str) -> None:
    try:
        _fetch_transcript(job, url)
        # Auto-advance through segmentation + translation so the current
        # linear review UI (polls for status == "ready", then reads `cues`)
        # keeps working unchanged. The staged wizard
        # (docs/mining-wizard-spec.md W5) stops here at `transcript` and
        # drives `run_segment` / `run_translate` explicitly instead.
        run_segment(job, None)
        run_translate(job)
        job.status = "ready"
        job.stage = "ready"
        job.set_message(f"Ready — {len(job.cues)} sentence(s) found.")
        _write_checkpoint(job)
    except Exception as exc:  # noqa: BLE001 - surfaced to the client as job.error
        logger.exception("Mining job %s failed", job.id)
        job.status = "error"
        job.stage = "error"
        job.set_message("Failed")
        job.error = str(exc)
        _write_checkpoint(job)


def _fetch_transcript(job: Job, url: str) -> None:
    """Download → cache → ASR/caption. Stops at the `transcript` stage with
    `job.raw_cues` / `job.transcript` populated — no resegmentation yet."""
    job.status = "fetching"
    job.stage = "fetching"
    job.set_message("Downloading audio…")
    # All three YouTube fetches (audio, subtitles, info) share one exit
    # node detour — flipping it per-call would thrash the box's routing.
    with exit_node.routed_for_download():
        job.source_audio_path = youtube.fetch_audio(url, job.dir)

        peak_db = clip.probe_max_volume_db(job.source_audio_path)
        if peak_db < config.SILENT_SOURCE_MAX_DB:
            raise RuntimeError(
                f"Downloaded source audio is silent (peak {peak_db:.0f} dBFS). "
                "YouTube likely served a silent stream — check the exit "
                "node (README 'YouTube's bot-check') or refresh cookies "
                "and retry."
            )

        job.set_message("Fetching subtitles…")
        youtube.download_subtitles(url, job.dir)

        job.set_message("Reading video info…")
        info = youtube.inspect_url(url)
    job.source = youtube.info_to_source(info)

    # Stash a compressed copy of the source outside the job sweep so a
    # later re-segment / audio repair re-cuts from the original, not from
    # lossy fragment clips. Best effort — never fail the job over it.
    cached_source: Path | None = None
    try:
        cached_source = source_cache.store(
            job.source.videoId, job.source_audio_path
        )
    except Exception:  # noqa: BLE001
        logger.warning(
            "source_cache.store failed for %s", job.source.videoId, exc_info=True
        )

    job.status = "parsing"
    subtitle_dir = job.dir / "subtitles"
    caption_cues = subtitles.load_cues_from_dir(subtitle_dir, language="ja")
    job.is_music = "Music" in (info.get("categories") or [])

    # A real (human) subtitle track beats Whisper — correct kanji, names,
    # no hallucination — and skips the slow ASR pass. YouTube's Japanese
    # auto-captions carry no sentence-final punctuation; a human track
    # does, so punctuation density tells them apart. For a Music-category
    # upload the caption track is the synced lyrics and Whisper would
    # hallucinate over the instrumentation, so prefer captions there even
    # without the punctuation signal.
    if caption_cues and (job.is_music or _looks_human_captioned(caption_cues)):
        logger.info(
            "Mining job %s: %s caption track (%d cues), skipping ASR",
            job.id,
            "lyrics" if job.is_music else "human",
            len(caption_cues),
        )
        job.set_message(
            "Reading lyrics…" if job.is_music else "Splitting sentences…"
        )
        keep_auto = job.is_music and not _looks_human_captioned(caption_cues)
        raw_cues = (
            caption_cues
            if keep_auto
            else [c.model_copy(update={"isAuto": False}) for c in caption_cues]
        )
        job.transcript_source = "lyrics" if job.is_music else "human-caption"
    else:
        job.set_message("Transcribing audio…")
        raw_cues = asr_client.transcribe_source(
            cached_source or job.source_audio_path
        )
        if raw_cues is not None:
            logger.info(
                "Mining job %s: ASR transcript, %d segment(s)",
                job.id,
                len(raw_cues),
            )
            job.transcript_source = "asr"
        else:
            job.set_message("Splitting sentences…")
            raw_cues = caption_cues
            # ASR was unreachable / empty → YouTube auto-captions: no
            # punctuation, whole-second timestamps. The wizard flags this.
            job.transcript_source = "auto-caption" if caption_cues else None

    job.raw_cues = [
        cue.model_copy(update={"index": i, "sourceIndexes": [i]})
        for i, cue in enumerate(raw_cues)
    ]
    job.transcript = [_to_transcript_segment(cue) for cue in job.raw_cues]
    job.cues = []
    job.english_by_index = {}
    job.rows = []
    job.stage = "transcript"
    job.set_message(f"Transcript ready — {len(job.transcript)} segment(s).")
    _write_checkpoint(job)


def _to_transcript_segment(cue: Cue) -> TranscriptSegment:
    return TranscriptSegment(
        text=cue.text,
        startMs=cue.startMs,
        endMs=cue.endMs,
        isAuto=cue.isAuto,
        lowConfidence=cue.lowConfidence,
    )


def run_segment(
    job: Job,
    segments: list[TranscriptSegmentInput] | None,
    *,
    merge: bool | None = None,
    split: bool = True,
) -> None:
    """(Re-)run resegmentation. `segments=None` uses the stored transcript
    (Whisper word timings intact); a list replaces it with the reviewer's
    corrected text. Clears any downstream translation — the sentence set
    changed. Re-runnable at any point after `transcript`."""
    if job.source is None:
        raise ValueError("Job is still fetching")

    if segments is None:
        base = list(job.raw_cues)
    else:
        base = [
            Cue(
                index=i,
                startMs=seg.startMs,
                endMs=seg.endMs,
                text=seg.text,
                isAuto=seg.isAuto,
                lowConfidence=seg.lowConfidence,
                sourceIndexes=[i],
            )
            for i, seg in enumerate(segments)
        ]
        job.transcript = [_to_transcript_segment(cue) for cue in base]

    # Skip the merge pass for lyrics — a Music upload, or any transcript with
    # almost no sentence-final punctuation, where merge_incomplete_cues would
    # fuse every line into one cue since none ends on 。 A Music upload never
    # merges regardless of what the client asked for.
    if merge is None:
        merge = not job.is_music and _terminal_punct_ratio(base) >= 0.15
    elif job.is_music:
        merge = False
    if not merge:
        logger.info("Mining job %s: keeping lines unmerged", job.id)

    job.cues = resegment.resegment_cues(base, merge=merge, split=split)
    job.english_by_index = {}
    job.rows = []
    job.stage = "segment"
    job.set_message(f"{len(job.cues)} sentence(s) segmented.")
    _write_checkpoint(job)


def run_translate(job: Job) -> None:
    """Align the EN subtitle track onto the current sentence boundaries.
    Re-runnable — a client can also redistribute translations itself and
    re-`run_segment` first."""
    if not job.cues:
        raise ValueError("Job has no segmented sentences to translate")
    subtitle_dir = job.dir / "subtitles"
    job.english_by_index = subtitles.load_parallel_text_from_dir(
        subtitle_dir, job.cues, language="en"
    )
    job.rows = [
        TranslatedRow(
            index=cue.index,
            japanese=cue.text,
            english=job.english_by_index.get(cue.index),
            startMs=cue.startMs,
            endMs=cue.endMs,
        )
        for cue in job.cues
    ]
    job.stage = "translate"
    job.set_message(f"{len(job.rows)} row(s) translated.")
    _write_checkpoint(job)


def job_status(job: Job) -> JobStatusResponse:
    return JobStatusResponse(
        jobId=job.id,
        status=job.status,
        stage=job.stage,
        message=job.message,
        elapsedSeconds=round(max(0.0, time.time() - job.message_started_at), 1),
        error=job.error,
        source=job.source,
        transcript=job.transcript or None,
        transcriptSource=job.transcript_source,
        cues=cues_out(job) if job.cues else None,
        rows=job.rows or None,
    )


def cues_out(job: Job) -> list[CueOut]:
    return [
        CueOut(
            index=cue.index,
            startMs=cue.startMs,
            endMs=cue.endMs,
            japanese=cue.text,
            isAuto=cue.isAuto,
            englishGuess=job.english_by_index.get(cue.index),
            lowConfidence=cue.lowConfidence,
            sourceIndexes=cue.sourceIndexes,
        )
        for cue in job.cues
    ]


def clip_range(job: Job, req: ClipRequest) -> ClipResponse:
    """Clip an explicit (startMs, endMs) span from the job's source audio
    with the sentence text supplied — the wizard's commit stage cuts every
    reviewed row this way, and the re-mine-reference-audio flow uses it for
    a source with no fetchable subtitle track."""
    if job.status != "ready":
        raise ValueError("Job is not ready for clipping yet")
    if req.startMs is None or req.endMs is None:
        raise ValueError("startMs and endMs are required")
    _ensure_source_audio(job)
    return _clip_range(job, req, req.startMs, req.endMs)


def _clip_range(
    job: Job,
    req: ClipRequest,
    start_ms: int,
    end_ms: int,
    *,
    media_duration_ms: int | None = None,
) -> ClipResponse:
    reading = readings.generate_reading(req.japanese) if req.generateKana else None
    tokens = morphology.tokenize_japanese(req.japanese) if req.generateKana else []

    if media_duration_ms is None:
        media_duration_ms = clip.probe_duration_ms(job.source_audio_path)
    subtitle_start, subtitle_end, adjusted_start, adjusted_end = clip.compute_boundaries(
        start_ms, end_ms, media_duration_ms=media_duration_ms
    )

    sentence_id = f"sentence-{job.next_sentence_seq:03d}-{uuid.uuid4().hex[:6]}"
    job.next_sentence_seq += 1
    clip_path = job.dir / "clips" / f"{sentence_id}.m4a"
    duration_ms = clip.clip_audio(
        job.source_audio_path, clip_path, start_ms=adjusted_start, end_ms=adjusted_end
    )
    job.clips[sentence_id] = ClipRecord(path=clip_path)

    return ClipResponse(
        sentenceId=sentence_id,
        japanese=req.japanese,
        reading=reading,
        english=req.english,
        startMs=start_ms,
        endMs=end_ms,
        subtitleStartMs=subtitle_start,
        subtitleEndMs=subtitle_end,
        adjustedStartMs=adjusted_start,
        adjustedEndMs=adjusted_end,
        transcriptStatus=req.transcriptStatus,
        tokens=tokens or None,
        audio=ClipAudioInfo(durationMs=duration_ms),
    )


def commit_job(job: Job, req: CommitJobRequest) -> list[CommitSentence]:
    """Clip every reviewed row from the source in one call and return each
    with its audio inline (base64), so the wizard's commit stage needs no
    per-row round trip. ffmpeg still runs serially — this only removes the
    HTTP overhead."""
    if job.status != "ready":
        raise ValueError("Job is not ready for clipping yet")
    _ensure_source_audio(job)
    # Probe the (constant) source once rather than once per row — a batch of
    # hundreds otherwise spawns hundreds of redundant ffprobe processes.
    media_duration_ms = clip.probe_duration_ms(job.source_audio_path)
    out: list[CommitSentence] = []
    for row in req.rows:
        clip_req = ClipRequest(
            japanese=row.japanese,
            english=row.english,
            startMs=row.startMs,
            endMs=row.endMs,
            generateKana=req.generateKana,
        )
        result = _clip_range(
            job, clip_req, row.startMs, row.endMs, media_duration_ms=media_duration_ms
        )
        audio_bytes = job.clips[result.sentenceId].path.read_bytes()
        out.append(
            CommitSentence(
                **result.model_dump(),
                audioBase64=base64.b64encode(audio_bytes).decode("ascii"),
            )
        )
    return out


def clip_audio_path(job: Job, sentence_id: str) -> Path:
    record = job.clips.get(sentence_id)
    if record is None:
        raise JobNotFoundError(sentence_id)
    return record.path


def source_audio_range(job: Job, start_ms: int, end_ms: int) -> Path:
    """Cut an arbitrary (start_ms, end_ms) span out of the job's downloaded
    source audio, for inline playback in any wizard stage — this is what
    every panel plays, replacing per-cue pre-clipping. Available as soon as
    the download lands (before resegmentation). Cached under the job dir and
    swept with the job; padded like every other clip via compute_boundaries.
    """
    if end_ms <= start_ms:
        raise ValueError("endMs must be greater than startMs")
    _ensure_source_audio(job)
    out = job.dir / "ranges" / f"{start_ms}-{end_ms}.m4a"
    if out.exists():
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    media_ms = clip.probe_duration_ms(job.source_audio_path)
    _, _, adj_start, adj_end = clip.compute_boundaries(
        start_ms, end_ms, media_duration_ms=media_ms
    )
    clip.clip_audio(
        job.source_audio_path, out, start_ms=adj_start, end_ms=adj_end
    )
    return out


def source_waveform(job: Job, start_ms: int, end_ms: int) -> dict:
    """Peak envelope + pause midpoints for [start_ms, end_ms) of the job's
    source audio — the segmentation editor's boundary waveform. Computed
    server-side (ffmpeg) so the browser never decodes a multi-minute span
    (that fails on iOS Safari). Not cached: the client fetches it once per
    span, and the span only moves when an outer boundary row is dragged."""
    if end_ms <= start_ms:
        raise ValueError("endMs must be greater than startMs")
    _ensure_source_audio(job)
    media_ms = clip.probe_duration_ms(job.source_audio_path)
    return waveform.waveform_for_span(
        job.source_audio_path, start_ms, min(end_ms, media_ms)
    )


def _sweep_once() -> None:
    now = time.time()
    idle_cutoff = now - config.JOB_TTL_SECONDS
    hard_cutoff = now - config.JOB_HARD_TTL_SECONDS
    for job_id, job in list(_JOBS.items()):
        if job.created_at < hard_cutoff:
            logger.info("Sweeping mining job %s (hard TTL)", job_id)
            delete_job(job_id)
        elif job.status in ("ready", "error") and job.touched_at < idle_cutoff:
            # An idle finished job: drop the scratch dir but keep the
            # checkpoint so the wizard can still resume it (get_job
            # rehydrates) until the hard ceiling.
            logger.info("Sweeping idle mining job %s (checkpoint kept)", job_id)
            delete_job(job_id, keep_checkpoint=True)
    # Discard checkpoints for jobs that have passed the hard TTL and are no
    # longer in memory.
    root = _checkpoint_root()
    if root.is_dir():
        for state_path in root.glob("*/state.json"):
            job_id = state_path.parent.name
            if job_id in _JOBS:
                continue
            try:
                created = json.loads(
                    state_path.read_text(encoding="utf-8")
                ).get("created_at", 0)
            except (OSError, ValueError):
                created = 0
            if created < hard_cutoff:
                logger.info("Discarding stale checkpoint %s", job_id)
                delete_job(job_id)


def _sweep_loop() -> None:
    while True:
        time.sleep(config.JOB_SWEEP_INTERVAL_SECONDS)
        try:
            _sweep_once()
        except Exception:  # noqa: BLE001 - a sweep error must not kill the thread
            logger.warning("Mining job sweep failed", exc_info=True)


def start_sweep_thread() -> None:
    threading.Thread(target=_sweep_loop, daemon=True).start()
