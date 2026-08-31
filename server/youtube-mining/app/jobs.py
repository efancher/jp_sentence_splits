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

import logging
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
    youtube,
)
from app.models import (
    ClipAudioInfo,
    ClipRequest,
    ClipResponse,
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


class CueIndexError(Exception):
    pass


@dataclass
class ClipRecord:
    path: Path
    mime_type: str = "audio/mp4"


@dataclass
class Job:
    id: str
    dir: Path
    created_at: float = field(default_factory=time.time)
    # Coarse lifecycle flag the linear review UI polls.
    status: JobState = "pending"
    # Finer, re-runnable pipeline position each wizard panel drives.
    stage: JobStage = "fetching"
    # Human-readable progress line for both UIs.
    message: str = "Queued…"
    error: str | None = None
    source: SourceInfo | None = None
    is_music: bool = False
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


_JOBS: dict[str, Job] = {}


def _job_dir(job_id: str) -> Path:
    return Path(config.JOBS_ROOT) / job_id


def create_job(url: str) -> Job:
    job_id = uuid.uuid4().hex[:12]
    job_dir = _job_dir(job_id)
    (job_dir / "clips").mkdir(parents=True, exist_ok=True)
    job = Job(id=job_id, dir=job_dir)
    _JOBS[job_id] = job
    threading.Thread(target=_run_job, args=(job, url), daemon=True).start()
    return job


def get_job(job_id: str) -> Job:
    job = _JOBS.get(job_id)
    if job is None:
        raise JobNotFoundError(job_id)
    return job


def delete_job(job_id: str) -> None:
    job = _JOBS.pop(job_id, None)
    if job is None:
        return
    shutil.rmtree(job.dir, ignore_errors=True)


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
        job.message = f"Ready — {len(job.cues)} sentence(s) found."
    except Exception as exc:  # noqa: BLE001 - surfaced to the client as job.error
        logger.exception("Mining job %s failed", job.id)
        job.status = "error"
        job.stage = "error"
        job.message = "Failed"
        job.error = str(exc)


def _fetch_transcript(job: Job, url: str) -> None:
    """Download → cache → ASR/caption. Stops at the `transcript` stage with
    `job.raw_cues` / `job.transcript` populated — no resegmentation yet."""
    job.status = "fetching"
    job.stage = "fetching"
    job.message = "Downloading audio…"
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

        job.message = "Fetching subtitles…"
        youtube.download_subtitles(url, job.dir)

        job.message = "Reading video info…"
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
        job.message = (
            "Reading lyrics…" if job.is_music else "Splitting sentences…"
        )
        keep_auto = job.is_music and not _looks_human_captioned(caption_cues)
        raw_cues = (
            caption_cues
            if keep_auto
            else [c.model_copy(update={"isAuto": False}) for c in caption_cues]
        )
    else:
        job.message = "Transcribing audio…"
        raw_cues = asr_client.transcribe_source(
            cached_source or job.source_audio_path
        )
        if raw_cues is not None:
            logger.info(
                "Mining job %s: ASR transcript, %d segment(s)",
                job.id,
                len(raw_cues),
            )
        else:
            job.message = "Splitting sentences…"
            raw_cues = caption_cues

    job.raw_cues = [
        cue.model_copy(update={"index": i, "sourceIndexes": [i]})
        for i, cue in enumerate(raw_cues)
    ]
    job.transcript = [_to_transcript_segment(cue) for cue in job.raw_cues]
    job.cues = []
    job.english_by_index = {}
    job.rows = []
    job.stage = "transcript"
    job.message = f"Transcript ready — {len(job.transcript)} segment(s)."


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
    job.message = f"{len(job.cues)} sentence(s) segmented."


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
    job.message = f"{len(job.rows)} row(s) translated."


def job_status(job: Job) -> JobStatusResponse:
    return JobStatusResponse(
        jobId=job.id,
        status=job.status,
        stage=job.stage,
        message=job.message,
        error=job.error,
        source=job.source,
        transcript=job.transcript or None,
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
        )
        for cue in job.cues
    ]


def clip_cue(job: Job, cue_index: int, req: ClipRequest) -> ClipResponse:
    if job.status != "ready" or job.source_audio_path is None:
        raise ValueError("Job is not ready for clipping yet")
    if cue_index < 0 or cue_index >= len(job.cues):
        raise CueIndexError(cue_index)
    cue = job.cues[cue_index]

    start_ms = req.startMs if req.startMs is not None else cue.startMs
    end_ms = req.endMs if req.endMs is not None else cue.endMs
    return _clip_range(job, req, start_ms, end_ms)


def clip_range(job: Job, req: ClipRequest) -> ClipResponse:
    """Clip an explicit (startMs, endMs) span from the job's source audio,
    without reference to a parsed subtitle cue — for callers that already
    have the sentence text and timings (e.g. re-mining reference audio whose
    source has no fetchable subtitle track)."""
    if job.status != "ready" or job.source_audio_path is None:
        raise ValueError("Job is not ready for clipping yet")
    if req.startMs is None or req.endMs is None:
        raise ValueError("startMs and endMs are required")
    return _clip_range(job, req, req.startMs, req.endMs)


def _clip_range(
    job: Job, req: ClipRequest, start_ms: int, end_ms: int
) -> ClipResponse:
    reading = readings.generate_reading(req.japanese) if req.generateKana else None
    tokens = morphology.tokenize_japanese(req.japanese) if req.generateKana else []

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


def clip_audio_path(job: Job, sentence_id: str) -> Path:
    record = job.clips.get(sentence_id)
    if record is None:
        raise JobNotFoundError(sentence_id)
    return record.path


def preview_cue_audio(job: Job, cue_index: int, through_index: int | None = None) -> Path:
    """Cut a cue's raw span from the source audio for playback during review —
    so the reviewer can hear a caption before deciding to keep it. With
    `through_index` the span runs from cue `cue_index`'s start to cue
    `through_index`'s end, for previewing a merge. Cached under the job dir
    (swept with the job); does not touch `job.clips` or the sentence sequence
    like `clip_cue` does."""
    if job.status != "ready" or job.source_audio_path is None:
        raise ValueError("Job is not ready for clipping yet")
    end_index = cue_index if through_index is None else through_index
    if cue_index < 0 or end_index >= len(job.cues) or end_index < cue_index:
        raise CueIndexError(cue_index)
    out = job.dir / "previews" / f"{cue_index}-{end_index}.m4a"
    if out.exists():
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    media_ms = clip.probe_duration_ms(job.source_audio_path)
    _, _, adj_start, adj_end = clip.compute_boundaries(
        job.cues[cue_index].startMs,
        job.cues[end_index].endMs,
        media_duration_ms=media_ms,
    )
    clip.clip_audio(job.source_audio_path, out, start_ms=adj_start, end_ms=adj_end)
    return out


def _sweep_loop() -> None:
    while True:
        time.sleep(config.JOB_SWEEP_INTERVAL_SECONDS)
        cutoff = time.time() - config.JOB_TTL_SECONDS
        stale = [job_id for job_id, job in _JOBS.items() if job.created_at < cutoff]
        for job_id in stale:
            logger.info("Sweeping stale mining job %s", job_id)
            delete_job(job_id)


def start_sweep_thread() -> None:
    threading.Thread(target=_sweep_loop, daemon=True).start()
