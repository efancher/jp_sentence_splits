import asyncio
import base64
import logging
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from starlette.background import BackgroundTask

from app import (
    align_client,
    alignment_backfill,
    clip,
    config,
    difficulty,
    jobs,
    metrics,
    morphology,
    nhk_easy,
    podcasts,
    readings,
    reclip,
    resegment,
    source_cache,
    status_page,
    validate,
    waveform,
    youtube,
)
from app.models import (
    AlignmentBackfillJobResponse,
    AlignmentBackfillRequest,
    AlignmentBackfillStatusResponse,
    ClipRequest,
    ClipResponse,
    CommitJobRequest,
    CommitJobResponse,
    CreateJobRequest,
    CreateJobResponse,
    Cue,
    DifficultyRequest,
    DifficultyScore,
    JobStatusResponse,
    JobSummary,
    NhkEasyImportRequest,
    NhkEasyImportResponse,
    NhkEasySentenceResult,
    PodcastFeed,
    PodcastFeedRequest,
    ReclipClip,
    ReclipRequest,
    ReclipResponse,
    ResegmentedCue,
    ResegmentRequest,
    SegmentJobRequest,
    SourceAudioInfo,
    SourceAudioRequest,
    SourceClipRequest,
    SourceRangeRequest,
    ValidateTranscriptRequest,
    ValidateTranscriptResponse,
    WaveformResponse,
)

logger = logging.getLogger("youtube_mining_api")


@asynccontextmanager
async def _lifespan(_: FastAPI):
    jobs.start_sweep_thread()
    yield


app = FastAPI(title="YouTube Mining API", lifespan=_lifespan)

# The jp_sentence_splits frontend only — this service is also restricted at
# the network layer (Tailscale-tailnet-only, same as shadowing-analysis-api);
# CORS is an extra layer, not the only one.
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/status", response_class=HTMLResponse)
async def status_html(days: int = 3):
    """No-JS resource glance — RAM/disk trend for the box + the two FastAPI
    services + the source cache. Fed by the `app.metrics` collector timer."""
    return status_page.render(metrics.load(days=days))


@app.get("/status.json")
async def status_json(days: int = 3):
    return {"current": metrics.sample(), "samples": metrics.load(days=days)}


@app.post("/jobs", response_model=CreateJobResponse)
async def create_job(req: CreateJobRequest):
    job = jobs.create_job(req.url, title=req.title, source_type=req.sourceType)
    return CreateJobResponse(jobId=job.id)


@app.post("/alignment-backfill/jobs", response_model=AlignmentBackfillJobResponse)
async def create_alignment_backfill_job(req: AlignmentBackfillRequest):
    """Precompute forced-alignment for reference audio (optionally scoped to
    one book) without needing SSH access to run the script by hand — see
    app/alignment_backfill.py."""
    job = alignment_backfill.start(req.bookId)
    return AlignmentBackfillJobResponse(jobId=job.id)


@app.get(
    "/alignment-backfill/jobs/{job_id}", response_model=AlignmentBackfillStatusResponse
)
async def get_alignment_backfill_job(job_id: str):
    try:
        job = alignment_backfill.get(job_id)
    except alignment_backfill.JobNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")
    return AlignmentBackfillStatusResponse(
        status=job.status,
        message=job.message,
        log=job.log,
        startedAt=job.started_at,
    )


@app.post("/podcast-feed", response_model=PodcastFeed)
async def podcast_feed(req: PodcastFeedRequest):
    """Fetch+parse a podcast RSS feed so the wizard can offer an episode
    picker instead of requiring a raw enclosure/mp3 URL. Server-side because
    a browser fetch of an arbitrary feed host would hit CORS."""
    try:
        return await podcasts.fetch_podcast_feed(req.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - network failure, surfaced as-is
        raise HTTPException(status_code=502, detail=f"Could not fetch feed: {exc}") from exc


def _nhk_easy_difficulty(results: list[NhkEasySentenceResult]) -> DifficultyScore:
    """Article-level difficulty readout (app/difficulty.py) reusing the
    `tokens` each result already carries — no second tokenize pass. Duration
    is the sum of per-sentence clip lengths when audio was cut, else None
    (text-only import has no timing signal for morae/second)."""
    groups = [r.tokens for r in results if r.tokens]
    total_duration_ms = sum(r.durationMs or 0 for r in results)
    duration_seconds = total_duration_ms / 1000 if total_duration_ms > 0 else None
    return difficulty.score_difficulty(groups, duration_seconds)


def _nhk_easy_import_sync(req: NhkEasyImportRequest) -> NhkEasyImportResponse:
    """Blocking body of POST /nhk-easy/import, run via asyncio.to_thread
    (ffmpeg + the align-service call are both blocking) — same convention
    as _reclip_sync/_source_range_sync below."""
    sentences = nhk_easy.parse_nhkeasier_description(req.descriptionHtml)
    if not sentences:
        raise HTTPException(status_code=400, detail="No sentences found in description")

    audio_bytes: bytes | None = None
    if req.audioUrl:
        try:
            resp = httpx.get(req.audioUrl, timeout=30.0, follow_redirects=True)
            resp.raise_for_status()
            audio_bytes = resp.content
        except Exception:  # noqa: BLE001 - degrade to text-only import
            logger.warning("Could not fetch NHK Easy audio %s", req.audioUrl, exc_info=True)

    spans = None
    if audio_bytes:
        transcript = "".join(s.japanese for s in sentences)
        words = align_client.align_audio(audio_bytes, "audio/mpeg", transcript)
        if words:
            spans = nhk_easy.assign_sentence_spans(sentences, words)

    if audio_bytes and spans:
        with tempfile.TemporaryDirectory() as tmp:
            source_path = Path(tmp) / "source.mp3"
            source_path.write_bytes(audio_bytes)
            results = []
            for i, (sentence, span) in enumerate(zip(sentences, spans)):
                out_path = Path(tmp) / f"clip_{i}.m4a"
                audio_b64: str | None = None
                duration_ms: int | None = None
                try:
                    duration_ms = clip.clip_audio(
                        source_path,
                        out_path,
                        start_ms=round(span.start_seconds * 1000),
                        end_ms=round(span.end_seconds * 1000),
                    )
                    audio_b64 = base64.b64encode(out_path.read_bytes()).decode()
                except Exception:  # noqa: BLE001 - this one sentence loses audio, not the import
                    logger.warning("Could not clip NHK Easy sentence %d", i, exc_info=True)
                results.append(
                    NhkEasySentenceResult(
                        japanese=sentence.japanese,
                        inlineReading=sentence.inline_reading,
                        audioBase64=audio_b64,
                        durationMs=duration_ms,
                        tokens=morphology.tokenize_japanese(sentence.japanese) or None,
                    )
                )
            return NhkEasyImportResponse(
                title=req.title,
                sentences=results,
                audioAligned=True,
                difficulty=_nhk_easy_difficulty(results),
            )

    text_only_results = [
        NhkEasySentenceResult(
            japanese=s.japanese,
            inlineReading=s.inline_reading,
            tokens=morphology.tokenize_japanese(s.japanese) or None,
        )
        for s in sentences
    ]
    return NhkEasyImportResponse(
        title=req.title,
        sentences=text_only_results,
        audioAligned=False,
        difficulty=_nhk_easy_difficulty(text_only_results),
    )


@app.post("/nhk-easy/import", response_model=NhkEasyImportResponse)
async def nhk_easy_import(req: NhkEasyImportRequest):
    """Parse an nhkeasier.com RSS item's known-good furigana text
    (app/nhk_easy.py) and, when its audio is reachable and forced-alignment
    lines up well enough to trust, cut one clip per sentence from the real
    NHK narration — never transcribes it, since the text is already known
    correct. Degrades to text-only sentences (audioAligned: false) when
    there's no audio, the align service is unreachable, or the alignment
    doesn't line up (app/nhk_easy.py's assign_sentence_spans returned None)
    — never fails the whole import over the audio half."""
    return await asyncio.to_thread(_nhk_easy_import_sync, req)


@app.get("/jobs", response_model=list[JobSummary])
async def list_jobs():
    """Every resumable job — in memory or checkpointed on disk — newest
    first, so the wizard can offer to continue an import started on another
    machine."""
    return [
        JobSummary(
            jobId=job.id,
            url=job.url,
            title=job.source.title if job.source else None,
            status=job.status,
            stage=job.stage,
            message=job.message,
            createdAt=job.created_at,
        )
        for job in jobs.list_jobs()
    ]


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job(job_id: str):
    try:
        job = jobs.get_job(job_id)
    except jobs.JobNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs.job_status(job)


@app.post("/jobs/{job_id}/segment", response_model=JobStatusResponse)
async def segment_job(job_id: str, req: SegmentJobRequest):
    """Accept a (corrected) transcript and re-run resegmentation on it.
    Re-runnable — drops any downstream translation, since the sentence set
    changed. See docs/mining-wizard-spec.md W1."""
    try:
        job = jobs.get_job(job_id)
    except jobs.JobNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        await asyncio.to_thread(
            jobs.run_segment,
            job,
            req.segments,
            merge=req.merge,
            split=req.split,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return jobs.job_status(job)


@app.post("/jobs/{job_id}/translate", response_model=JobStatusResponse)
async def translate_job(job_id: str):
    """Align the EN subtitle track onto the current sentence boundaries and
    return the per-sentence rows. Re-runnable."""
    try:
        job = jobs.get_job(job_id)
    except jobs.JobNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        await asyncio.to_thread(jobs.run_translate, job)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return jobs.job_status(job)


@app.get("/jobs/{job_id}/audio")
async def get_job_audio(job_id: str, startMs: int, endMs: int):  # noqa: N803
    """Stream an arbitrary (startMs, endMs) span of the job's source audio —
    what every wizard panel plays. See docs/mining-wizard-spec.md W2."""
    try:
        job = jobs.get_job(job_id)
        path = await asyncio.to_thread(
            jobs.source_audio_range, job, startMs, endMs
        )
    except jobs.JobNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return FileResponse(path, media_type="audio/mp4")


@app.get("/jobs/{job_id}/waveform", response_model=WaveformResponse)
async def get_job_waveform(job_id: str, startMs: int, endMs: int):  # noqa: N803
    """Down-sampled peak envelope + pause midpoints for a (startMs, endMs)
    span of the job's source audio — the segmentation editor's boundary
    waveform, computed here so the browser never decodes the span."""
    try:
        job = jobs.get_job(job_id)
        return await asyncio.to_thread(jobs.source_waveform, job, startMs, endMs)
    except jobs.JobNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except (RuntimeError, subprocess.CalledProcessError) as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/jobs/{job_id}/clip", response_model=ClipResponse)
async def clip_range(job_id: str, req: ClipRequest):
    """Clip an explicit (startMs, endMs) span from the job's downloaded
    source audio with the sentence text supplied — the wizard's commit
    stage cuts every reviewed row this way."""
    try:
        job = jobs.get_job(job_id)
    except jobs.JobNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        return await asyncio.to_thread(jobs.clip_range, job, req)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@app.post("/jobs/{job_id}/commit", response_model=CommitJobResponse)
async def commit_job(job_id: str, req: CommitJobRequest):
    """Clip every reviewed row from the source in one request, each with its
    audio inline (base64). The wizard's commit stage."""
    try:
        job = jobs.get_job(job_id)
    except jobs.JobNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        sentences = await asyncio.to_thread(jobs.commit_job, job, req)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except subprocess.CalledProcessError as exc:
        raise HTTPException(status_code=500, detail=f"ffmpeg failed: {exc.stderr}")
    return CommitJobResponse(sentences=sentences)


@app.get("/jobs/{job_id}/clips/{sentence_id}/audio")
async def get_clip_audio(job_id: str, sentence_id: str):
    try:
        job = jobs.get_job(job_id)
        path = jobs.clip_audio_path(job, sentence_id)
    except jobs.JobNotFoundError:
        raise HTTPException(status_code=404, detail="Clip not found")
    return FileResponse(path, media_type="audio/mp4")


@app.delete("/jobs/{job_id}")
async def delete_job(job_id: str):
    jobs.delete_job(job_id)
    return {"status": "deleted"}


def _resegment_sync(req: ResegmentRequest) -> list[ResegmentedCue]:
    cues = [
        Cue(
            index=i,
            startMs=s.startMs,
            endMs=s.endMs,
            text=s.japanese,
            isAuto=True,
            sourceIndexes=[i],
        )
        for i, s in enumerate(req.sentences)
    ]
    if req.merge:
        cues = resegment.merge_incomplete_cues(cues)
    if req.split:
        cues = resegment.split_multi_sentence_cues(cues)
    out: list[ResegmentedCue] = []
    for cue in cues:
        out.append(
            ResegmentedCue(
                japanese=cue.text,
                startMs=cue.startMs,
                endMs=cue.endMs,
                reading=readings.generate_reading(cue.text) if req.generateKana else None,
                tokens=(morphology.tokenize_japanese(cue.text) or None)
                if req.generateKana
                else None,
                sourceIndexes=cue.sourceIndexes
                if cue.sourceIndexes is not None
                else [cue.index],
            )
        )
    return out


def _reclip_sync(req: ReclipRequest) -> ReclipResponse:
    results = reclip.reclip_group(
        req.clipsBase64,
        [(c.startMs, c.endMs) for c in req.cuts],
        trim_silence=req.trimSilence,
    )
    return ReclipResponse(
        clips=[
            ReclipClip(audioBase64=audio, durationMs=duration)
            for audio, duration in results
        ]
    )


@app.post("/reclip", response_model=ReclipResponse)
async def reclip_sentences(req: ReclipRequest):
    """Re-cut reference audio onto new sentence boundaries after re-segmentation.

    Stateless: concatenates the supplied old per-fragment clips and cuts the
    requested sub-ranges. No job, no yt-dlp, no source download.
    """
    try:
        return await asyncio.to_thread(_reclip_sync, req)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except subprocess.CalledProcessError as exc:
        raise HTTPException(status_code=500, detail=f"ffmpeg failed: {exc.stderr}")


def _source_clip_sync(req: SourceClipRequest) -> ReclipResponse:
    cached = source_cache.ensure(req.url)
    media_ms = clip.probe_duration_ms(cached)
    clips: list[ReclipClip] = []
    with tempfile.TemporaryDirectory(prefix="source-clip-") as tmp:
        for i, cut in enumerate(req.cuts):
            _, _, adj_start, adj_end = clip.compute_boundaries(
                cut.startMs, cut.endMs, media_duration_ms=media_ms
            )
            out = Path(tmp) / f"cut-{i}.m4a"
            duration = clip.clip_audio(
                cached, out, start_ms=adj_start, end_ms=adj_end
            )
            clips.append(
                ReclipClip(
                    audioBase64=base64.b64encode(out.read_bytes()).decode("ascii"),
                    durationMs=duration,
                )
            )
    return ReclipResponse(clips=clips)


@app.post("/source-audio", response_model=SourceAudioInfo)
async def ensure_source_audio(req: SourceAudioRequest):
    """Ensure the video's source audio is in the persistent cache
    (downloading + transcoding it if absent), and return its metadata."""
    try:
        path = await asyncio.to_thread(source_cache.ensure, req.url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except (RuntimeError, subprocess.CalledProcessError) as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    duration_ms, size_bytes = source_cache.info(path)
    video_id = youtube.extract_video_id(req.url) or ""
    return SourceAudioInfo(
        videoId=video_id, durationMs=duration_ms, sizeBytes=size_bytes
    )


@app.get("/source-audio/{video_id}")
async def get_source_audio(video_id: str):
    path = source_cache.get(video_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Source audio not cached")
    return FileResponse(path, media_type=source_cache.MIME_TYPE)


def _source_range_sync(req: SourceRangeRequest) -> tuple[Path, Callable[[], None]]:
    if req.endMs <= req.startMs:
        raise ValueError("endMs must be greater than startMs")
    cached = source_cache.ensure(req.url)
    media_ms = clip.probe_duration_ms(cached)
    _, _, adj_start, adj_end = clip.compute_boundaries(
        req.startMs, req.endMs, media_duration_ms=media_ms
    )
    tmp = Path(tempfile.mkdtemp(prefix="source-range-"))
    out = tmp / "range.m4a"
    clip.clip_audio(cached, out, start_ms=adj_start, end_ms=adj_end)
    return out, lambda: shutil.rmtree(tmp, ignore_errors=True)


@app.post("/source-audio/range")
async def source_audio_range(req: SourceRangeRequest):
    """Stream one (startMs, endMs) span of a video's cached source audio for
    the re-segment page's boundary waveform. Ensures the source is cached
    first (a slow first call per video)."""
    try:
        out, cleanup = await asyncio.to_thread(_source_range_sync, req)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except (RuntimeError, subprocess.CalledProcessError) as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return FileResponse(
        out, media_type="audio/mp4", background=BackgroundTask(cleanup)
    )


@app.post("/source-audio/waveform", response_model=WaveformResponse)
async def source_audio_waveform(req: SourceRangeRequest):
    """Peak envelope + pause midpoints for one span of a video's cached
    source audio — the re-segment page's boundary waveform (the wizard uses
    the job-scoped GET /jobs/{id}/waveform). Ensures the source is cached
    first (a slow first call per video)."""
    if req.endMs <= req.startMs:
        raise HTTPException(status_code=422, detail="endMs must be greater than startMs")
    try:
        cached = await asyncio.to_thread(source_cache.ensure, req.url)
        media_ms = await asyncio.to_thread(clip.probe_duration_ms, cached)
        return await asyncio.to_thread(
            waveform.waveform_for_span,
            cached,
            req.startMs,
            min(req.endMs, media_ms),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except (RuntimeError, subprocess.CalledProcessError) as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/source-audio/clip", response_model=ReclipResponse)
async def clip_source_audio(req: SourceClipRequest):
    """Cut absolute (startMs, endMs) spans out of a video's cached source
    audio — re-cut a book's reference clips from the original source rather
    than from lossy fragment clips. Ensures the source is cached first."""
    try:
        return await asyncio.to_thread(_source_clip_sync, req)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except (RuntimeError, subprocess.CalledProcessError) as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/resegment", response_model=list[ResegmentedCue])
async def resegment_sentences(req: ResegmentRequest):
    """Re-segment an already-imported source's sentences without re-downloading.

    Stateless: no job, no yt-dlp, no ffmpeg. `merge`/`split` default true
    (drama transcripts); both false is annotate-only (lyrics/manual mode).
    """
    return await asyncio.to_thread(_resegment_sync, req)


@app.post("/difficulty", response_model=DifficultyScore)
async def difficulty_score(req: DifficultyRequest):
    """Rough beginner/intermediate/advanced screening readout on the
    wizard's current Transcript-stage text (see docs/ROADMAP.md, "Podcast
    mining" item 5) — surfaced before "Apply & segment" so a too-hard source
    can be abandoned early. Stateless, no job: same pattern as /resegment
    and /validate-transcript, and works on hand-edited text the reviewer
    hasn't saved anywhere yet."""
    segments = [(s.text, s.startMs, s.endMs) for s in req.segments]
    groups, duration_seconds = await asyncio.to_thread(
        difficulty.tokenize_segments_for_scoring, segments
    )
    return difficulty.score_difficulty(groups, duration_seconds)


@app.post("/validate-transcript", response_model=ValidateTranscriptResponse)
async def validate_transcript(req: ValidateTranscriptRequest):
    """Cross-checks `expectedText` against a fresh ASR pass of the supplied
    clip (see app/validate.py) — a review-queue signal, not a gate: this
    never writes anything, and a low similarity score doesn't mean the
    stored text is wrong (ASR errs too, especially on short/noisy clips).
    Stateless, no job."""
    audio_bytes = base64.b64decode(req.audioBase64)
    result = await asyncio.to_thread(
        validate.validate_sentence_audio, audio_bytes, req.mimeType, req.expectedText
    )
    return ValidateTranscriptResponse(**result)
