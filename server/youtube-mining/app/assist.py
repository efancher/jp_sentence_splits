"""Run a text prompt through a local LLM CLI (Codex, then Claude) so the
frontend can automate its "copy prompt into a chat, paste the reply back"
step. One request at a time (a single run lock), single attempt per backend —
the client owns retry policy so a misbehaving run can't loop unattended.
Jobs live in memory only; a service restart drops them and the client
resubmits.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from app import config

logger = logging.getLogger("youtube_mining_api.assist")

JOB_RETENTION_SECONDS = 60 * 60
_ERROR_TAIL_CHARS = 400


class AssistError(Exception):
    pass


@dataclass
class AssistJob:
    id: str
    status: str = "queued"
    backend: str | None = None
    reply: str | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)


_jobs: dict[str, AssistJob] = {}
_jobs_lock = threading.Lock()
_run_lock = threading.Lock()


def _resolve(configured: str | None, name: str) -> str:
    path = configured or shutil.which(name)
    if not path or not Path(path).exists():
        raise AssistError(f"{name} CLI not found (set MINING_{name.upper()}_PATH)")
    return path


def _env_for(binary: str) -> dict[str, str]:
    env = dict(os.environ)
    env["PATH"] = f"{Path(binary).absolute().parent}{os.pathsep}{env.get('PATH', '')}"
    return env


def _tail(text: str) -> str:
    text = text.strip()
    return text[-_ERROR_TAIL_CHARS:] if text else "no output"


def _run(cmd: list[str], prompt: str, binary: str, cwd: str) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            cmd,
            input=prompt,
            capture_output=True,
            text=True,
            cwd=cwd,
            env=_env_for(binary),
            timeout=config.ASSIST_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise AssistError(f"timed out after {config.ASSIST_TIMEOUT_SECONDS}s") from exc
    except OSError as exc:
        raise AssistError(str(exc)) from exc


def run_codex(prompt: str) -> str:
    binary = _resolve(config.CODEX_PATH, "codex")
    with tempfile.TemporaryDirectory(prefix="assist-codex-") as tmp:
        out_file = Path(tmp) / "reply.txt"
        proc = _run(
            [
                binary,
                "exec",
                "--skip-git-repo-check",
                "--sandbox",
                "read-only",
                "-o",
                str(out_file),
                "-",
            ],
            prompt,
            binary,
            tmp,
        )
        if proc.returncode != 0:
            raise AssistError(f"exit {proc.returncode}: {_tail(proc.stderr)}")
        reply = out_file.read_text(encoding="utf-8") if out_file.exists() else ""
    if not reply.strip():
        raise AssistError("empty reply")
    return reply


def run_claude(prompt: str) -> str:
    binary = _resolve(config.CLAUDE_PATH, "claude")
    with tempfile.TemporaryDirectory(prefix="assist-claude-") as tmp:
        proc = _run(
            [
                binary,
                "-p",
                "--output-format",
                "text",
                "--no-session-persistence",
                "--tools",
                "",
                "--disable-slash-commands",
            ],
            prompt,
            binary,
            tmp,
        )
    if proc.returncode != 0:
        raise AssistError(f"exit {proc.returncode}: {_tail(proc.stderr or proc.stdout)}")
    if not proc.stdout.strip():
        raise AssistError("empty reply")
    return proc.stdout


RUNNERS = {"codex": run_codex, "claude": run_claude}


def backend_order(requested: str) -> list[str]:
    if requested != "auto":
        return [requested]
    return [name for name in config.ASSIST_BACKENDS if name in RUNNERS]


def _execute(job: AssistJob, backends: list[str], prompt: str) -> None:
    with _run_lock:
        job.status = "running"
        errors: list[str] = []
        for name in backends:
            job.backend = name
            try:
                job.reply = RUNNERS[name](prompt)
                job.status = "done"
                return
            except AssistError as exc:
                logger.warning("assist backend %s failed: %s", name, exc)
                errors.append(f"{name}: {exc}")
        job.error = "; ".join(errors) or "no assist backend configured"
        job.status = "error"


def _sweep() -> None:
    cutoff = time.time() - JOB_RETENTION_SECONDS
    for job_id in [j.id for j in _jobs.values() if j.created_at < cutoff]:
        _jobs.pop(job_id, None)


def submit(prompt: str, backend: str = "auto") -> AssistJob:
    job = AssistJob(id=uuid.uuid4().hex)
    with _jobs_lock:
        _sweep()
        _jobs[job.id] = job
    threading.Thread(
        target=_execute, args=(job, backend_order(backend), prompt), daemon=True
    ).start()
    return job


def get(job_id: str) -> AssistJob | None:
    with _jobs_lock:
        return _jobs.get(job_id)
