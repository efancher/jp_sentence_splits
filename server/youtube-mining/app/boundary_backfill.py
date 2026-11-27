"""Trigger scripts/refine-reference-clip-boundaries.ts from the UI for one book.

Same pattern as app/alignment_backfill.py: the script does the real work
(Supabase auth, forced-alignment via this service's /source-audio/clip,
re-uploading clips); this module runs it as a subprocess and exposes
progress. State is process-memory only — a restart mid-run drops the job, and
the script is idempotent (already-refined clips shift ~0 and are skipped).
"""

from __future__ import annotations

import logging
import os
import subprocess
import threading
import uuid
from pathlib import Path

from app.alignment_backfill import (
    NODE_BINARY,
    REPO_ROOT,
    TSX_CLI,
    Job,
    JobNotFoundError,
)

logger = logging.getLogger("youtube_mining_api.boundary_backfill")

SCRIPT_PATH: Path = REPO_ROOT / "scripts" / "refine-reference-clip-boundaries.ts"
# The script talks back to this same service for the cut + alignment.
SELF_API_BASE = os.environ.get("MINING_SELF_API_BASE", "http://127.0.0.1:8003")

# A preview prints one line per clip, so keep more history than the alignment job.
_LOG_TAIL = 300

_JOBS: dict[str, Job] = {}

__all__ = ["Job", "JobNotFoundError", "start", "get"]


def start(book_id: str, *, apply: bool) -> Job:
    job = Job(id=uuid.uuid4().hex[:12])
    _JOBS[job.id] = job
    threading.Thread(target=_run, args=(job, book_id, apply), daemon=True).start()
    return job


def get(job_id: str) -> Job:
    job = _JOBS.get(job_id)
    if job is None:
        raise JobNotFoundError(job_id)
    return job


def _run(job: Job, book_id: str, apply: bool) -> None:
    args = [NODE_BINARY, str(TSX_CLI), str(SCRIPT_PATH), "--book", book_id]
    if apply:
        args.append("--apply")
    try:
        proc = subprocess.Popen(
            args,
            cwd=REPO_ROOT,
            env={**os.environ, "MINING_API_BASE": SELF_API_BASE},
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.rstrip("\n")
            if not line:
                continue
            job.log.append(line)
            del job.log[:-_LOG_TAIL]
            job.message = line
        returncode = proc.wait()
        if returncode != 0:
            job.status = "error"
            job.message = f"Failed (exit {returncode}) — {job.message}"
        else:
            job.status = "done"
    except Exception as exc:  # noqa: BLE001 - surfaced to the client as job.message
        logger.exception("Boundary backfill job %s failed", job.id)
        job.status = "error"
        job.message = str(exc)
