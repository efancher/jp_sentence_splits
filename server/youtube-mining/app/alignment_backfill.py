"""Trigger scripts/backfill-reference-alignment.ts from the UI, optionally
scoped to one book.

Precomputes forced-alignment for reference recordings so review-time word
audio isolation (`SegmentLoopPlayer` / `isolatedWordRange` — pitch_accent /
word_listening cards) doesn't hit the aligner's cold start live during study.
The script already does the real work (Supabase auth, pagination, calling
the aligner, upserting `reference_alignment`); this module just runs it as a
subprocess and exposes progress, so the user doesn't need SSH access to the
box to kick it off.

Deliberately separate from app/jobs.py, which is mining-pipeline-specific
(scratch dirs, source audio, checkpoints) — none of that applies here. State
is process-memory only: a service restart mid-run just means the job is gone
and the button can be clicked again (the script is idempotent, see its
docstring).
"""

from __future__ import annotations

import logging
import os
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger("youtube_mining_api.alignment_backfill")

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "backfill-reference-alignment.ts"
TSX_CLI = REPO_ROOT / "node_modules" / "tsx" / "dist" / "cli.mjs"

# Reuse the nvm-managed node path already configured for yt-dlp's JS
# challenge solver (see app/config.py YTDLP_JS_RUNTIME_PATH) — the systemd
# unit's plain PATH doesn't include nvm's, and this is the same binary need.
NODE_BINARY = (
    os.environ.get("MINING_NODE_BINARY_PATH")
    or os.environ.get("MINING_YTDLP_JS_RUNTIME_PATH")
    or "node"
)

# How many recent stdout lines to keep for the UI's progress display.
_LOG_TAIL = 30


class JobNotFoundError(Exception):
    pass


@dataclass
class Job:
    id: str
    status: str = "running"  # "running" | "done" | "error"
    message: str = "Starting…"
    log: list[str] = field(default_factory=list)
    started_at: float = field(default_factory=time.time)


_JOBS: dict[str, Job] = {}


def start(book_id: str | None) -> Job:
    job = Job(id=uuid.uuid4().hex[:12])
    _JOBS[job.id] = job
    threading.Thread(target=_run, args=(job, book_id), daemon=True).start()
    return job


def get(job_id: str) -> Job:
    job = _JOBS.get(job_id)
    if job is None:
        raise JobNotFoundError(job_id)
    return job


def _run(job: Job, book_id: str | None) -> None:
    args = [NODE_BINARY, str(TSX_CLI), str(SCRIPT_PATH), "--apply"]
    if book_id:
        args += ["--book", book_id]
    try:
        proc = subprocess.Popen(
            args,
            cwd=REPO_ROOT,
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
        logger.exception("Alignment backfill job %s failed", job.id)
        job.status = "error"
        job.message = str(exc)
