import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app import config, jobs, morphology, readings, resegment
from app.models import (
    ClipRequest,
    ClipResponse,
    CreateJobRequest,
    CreateJobResponse,
    Cue,
    JobStatusResponse,
    ResegmentedCue,
    ResegmentRequest,
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


@app.post("/jobs", response_model=CreateJobResponse)
async def create_job(req: CreateJobRequest):
    job = jobs.create_job(req.url)
    return CreateJobResponse(jobId=job.id)


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job(job_id: str):
    try:
        job = jobs.get_job(job_id)
    except jobs.JobNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobStatusResponse(
        jobId=job.id,
        status=job.status,
        stage=job.stage,
        error=job.error,
        source=job.source,
        cues=jobs.cues_out(job) if job.status == "ready" else None,
    )


@app.post("/jobs/{job_id}/cues/{cue_index}/clip", response_model=ClipResponse)
async def clip_cue(job_id: str, cue_index: int, req: ClipRequest):
    try:
        job = jobs.get_job(job_id)
    except jobs.JobNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        return await asyncio.to_thread(jobs.clip_cue, job, cue_index, req)
    except jobs.CueIndexError:
        raise HTTPException(status_code=404, detail="Cue not found")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


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


@app.post("/resegment", response_model=list[ResegmentedCue])
async def resegment_sentences(req: ResegmentRequest):
    """Re-segment an already-imported source's sentences without re-downloading.

    Stateless: no job, no yt-dlp, no ffmpeg. `merge`/`split` default true
    (drama transcripts); both false is annotate-only (lyrics/manual mode).
    """
    return await asyncio.to_thread(_resegment_sync, req)
