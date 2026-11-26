"""Background clipping of a reviewed row set.

Quick import used to clip through `POST /jobs/{id}/commit` in 30-row requests
the browser had to keep alive (a phone that slept mid-way failed the whole
step). This runs the same ffmpeg pass in a server thread instead: the client
starts a batch, polls its progress, and downloads the finished clips. The
batch is keyed by a hash of its rows, so starting the same rows again resumes
(or returns) the existing batch rather than re-cutting; progress is also
written beside the job checkpoint so a service restart resumes too.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path

from . import clip, jobs
from .models import ClipBatchStatus, ClipRequest, ClipResponse, CommitJobRequest

logger = logging.getLogger(__name__)


@dataclass
class _Batch:
    key: str
    total: int
    results: list[ClipResponse] = field(default_factory=list)
    status: str = "running"  # running | done | failed
    error: str | None = None
    thread: threading.Thread | None = None


_BATCHES: dict[str, _Batch] = {}
_LOCK = threading.Lock()


def _key(req: CommitJobRequest) -> str:
    payload = json.dumps(
        [req.generateKana, [row.model_dump() for row in req.rows]],
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def _state_path(job: jobs.Job) -> Path:
    return jobs._checkpoint_dir(job.id) / "clip-batch.json"


def _persist(job: jobs.Job, batch: _Batch) -> None:
    try:
        path = _state_path(job)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(
                {
                    "key": batch.key,
                    "total": batch.total,
                    "results": [r.model_dump() for r in batch.results],
                }
            ),
            encoding="utf-8",
        )
        os.replace(tmp, path)
    except Exception:  # noqa: BLE001 - progress persistence is best effort
        logger.warning("Clip batch persist failed for job %s", job.id, exc_info=True)


def _register(job: jobs.Job, result: ClipResponse) -> bool:
    path = job.dir / "clips" / f"{result.sentenceId}.m4a"
    if not path.is_file():
        return False
    job.clips[result.sentenceId] = jobs.ClipRecord(path=path)
    return True


def _load(job: jobs.Job, key: str) -> _Batch | None:
    try:
        state = json.loads(_state_path(job).read_text(encoding="utf-8"))
        if state.get("key") != key:
            return None
        batch = _Batch(key=key, total=int(state["total"]))
        for raw in state.get("results", []):
            result = ClipResponse.model_validate(raw)
            if not _register(job, result):
                break  # swept clip files: redo from here
            batch.results.append(result)
        return batch
    except Exception:  # noqa: BLE001
        return None


def _run(job: jobs.Job, batch: _Batch, req: CommitJobRequest) -> None:
    try:
        jobs._ensure_source_audio(job)
        media_ms = clip.probe_duration_ms(job.source_audio_path)
        for row in req.rows[len(batch.results) :]:
            clip_req = ClipRequest(
                japanese=row.japanese,
                english=row.english,
                startMs=row.startMs,
                endMs=row.endMs,
                generateKana=req.generateKana,
            )
            result = jobs._clip_range(
                job, clip_req, row.startMs, row.endMs, media_duration_ms=media_ms
            )
            batch.results.append(result)
            job.touch()
            _persist(job, batch)
        batch.status = "done"
    except Exception as exc:  # noqa: BLE001 - surfaced to the client as a failed batch
        logger.warning("Clip batch failed for job %s", job.id, exc_info=True)
        batch.error = str(exc) or exc.__class__.__name__
        batch.status = "failed"
    _persist(job, batch)


def start(job: jobs.Job, req: CommitJobRequest) -> ClipBatchStatus:
    """Start (or resume, or return) the batch for these rows."""
    if job.status != "ready":
        raise ValueError("Job is not ready for clipping yet")
    key = _key(req)
    with _LOCK:
        batch = _BATCHES.get(job.id)
        if batch is None or batch.key != key:
            batch = _load(job, key) or _Batch(key=key, total=len(req.rows))
            _BATCHES[job.id] = batch
        alive = batch.thread is not None and batch.thread.is_alive()
        if not alive and len(batch.results) < batch.total:
            batch.status = "running"
            batch.error = None
            batch.thread = threading.Thread(
                target=_run, args=(job, batch, req), daemon=True
            )
            batch.thread.start()
        elif not alive:
            batch.status = "done"
    return _status(batch)


def status(job: jobs.Job) -> ClipBatchStatus | None:
    batch = _BATCHES.get(job.id)
    return _status(batch) if batch else None


def _status(batch: _Batch) -> ClipBatchStatus:
    return ClipBatchStatus(
        status=batch.status,  # type: ignore[arg-type]
        total=batch.total,
        done=len(batch.results),
        error=batch.error,
        sentences=list(batch.results) if batch.status == "done" else None,
    )


def forget(job_id: str) -> None:
    _BATCHES.pop(job_id, None)
