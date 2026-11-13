"""Run a text prompt through a local LLM CLI (Codex, Claude or opencode) so the
frontend can automate its "copy prompt into a chat, paste the reply back"
step. A bounded number of requests at a time (MINING_ASSIST_MAX_CONCURRENCY, default 3), single attempt per backend —
the client owns retry policy so a misbehaving run can't loop unattended.
Jobs live in memory only; a service restart drops them and the client
resubmits.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from app import config

logger = logging.getLogger("youtube_mining_api.assist")

JOB_RETENTION_SECONDS = 60 * 60
_ERROR_TAIL_CHARS = 400
# A healthy backend answers a one-word probe in seconds even while it is busy with a long reply; one that is out
# of credits (or wedged) hangs on it. Output is silent during a long reply, so a quiet process alone proves nothing.
PROBE_PROMPT = "Reply with the single word: ok"
PROBE_AFTER_SECONDS = 90
PROBE_TIMEOUT_SECONDS = 30
BACKEND_DOWN_SECONDS = 15 * 60


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
    # Start (epoch seconds) of the attempt now running, and what each finished attempt did.
    attempt_started_at: float | None = None
    attempts: list[dict] = field(default_factory=list)
    # Caller's short note on what was asked (e.g. "structure sentences 1-10"); only used in the call log.
    label: str | None = None
    prompt_chars: int = 0


_ctx = threading.local()
_down_until: dict[str, float] = {}
_jobs: dict[str, AssistJob] = {}
_jobs_lock = threading.Lock()
_run_slots = threading.BoundedSemaphore(config.ASSIST_MAX_CONCURRENCY)


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
    timeout = getattr(_ctx, "timeout", None) or config.ASSIST_TIMEOUT_SECONDS
    abort: threading.Event | None = getattr(_ctx, "abort", None)
    # opencode finds its project config through $PWD, which Popen's cwd does not update.
    env = {**_env_for(binary), "PWD": cwd}
    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=cwd,
            env=env,
        )
    except OSError as exc:
        raise AssistError(str(exc)) from exc
    result: list[tuple[str, str]] = []
    worker = threading.Thread(target=lambda: result.append(proc.communicate(prompt)), daemon=True)
    worker.start()
    deadline = time.monotonic() + timeout
    while worker.is_alive():
        worker.join(0.5)
        if not worker.is_alive():
            break
        stop = (
            f"timed out after {timeout}s"
            if time.monotonic() > deadline
            else "stopped: the backend stopped responding"
            if abort is not None and abort.is_set()
            else None
        )
        if stop:
            proc.kill()
            worker.join(5)
            raise AssistError(stop)
    stdout, stderr = result[0] if result else ("", "")
    return subprocess.CompletedProcess(cmd, proc.returncode, stdout, stderr)


def _override(key: str, configured: str) -> str:
    """The per-request model/effort for the requested backend, else the configured default."""
    return (getattr(_ctx, "overrides", None) or {}).get(key) or configured


def codex_args() -> list[str]:
    args: list[str] = []
    model, effort = _override("model", config.CODEX_ASSIST_MODEL), _override("effort", config.CODEX_ASSIST_EFFORT)
    if model:
        args += ["-m", model]
    if effort:
        args += ["-c", f'model_reasoning_effort="{effort}"']
    return args


def claude_args() -> list[str]:
    args: list[str] = []
    model, effort = _override("model", config.CLAUDE_ASSIST_MODEL), _override("effort", config.CLAUDE_ASSIST_EFFORT)
    if model:
        args += ["--model", model]
    if effort:
        args += ["--effort", effort]
    return args


def opencode_args() -> list[str]:
    args: list[str] = []
    model = _override("model", config.OPENCODE_ASSIST_MODEL)
    effort = _override("effort", config.OPENCODE_ASSIST_EFFORT)
    if model:
        args += ["-m", model]
    if effort:
        args += ["--variant", effort]
    return args


def _model_and_effort(name: str) -> tuple[str, str]:
    """The model and reasoning effort `name` runs with: a per-request override, else its configured default."""
    defaults = {
        "codex": (config.CODEX_ASSIST_MODEL, config.CODEX_ASSIST_EFFORT),
        "claude": (config.CLAUDE_ASSIST_MODEL, config.CLAUDE_ASSIST_EFFORT),
        "opencode": (config.OPENCODE_ASSIST_MODEL, config.OPENCODE_ASSIST_EFFORT),
    }[name]
    return _override("model", defaults[0]), _override("effort", defaults[1])


# opencode has no "no tools" flag; a project config in the (temporary) working directory defines an agent
# with every permission denied, so the reply is text only.
OPENCODE_AGENT = "assist"
OPENCODE_PROJECT_CONFIG = {
    "$schema": "https://opencode.ai/config.json",
    "permission": {"*": "deny"},
    "agent": {
        OPENCODE_AGENT: {
            "mode": "primary",
            "description": "Text-only reply, no tools",
            "permission": {"*": "deny"},
        }
    },
}


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
                *codex_args(),
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
                *claude_args(),
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


def run_opencode(prompt: str) -> str:
    binary = _resolve(config.OPENCODE_PATH, "opencode")
    with tempfile.TemporaryDirectory(prefix="assist-opencode-") as tmp:
        (Path(tmp) / "opencode.json").write_text(json.dumps(OPENCODE_PROJECT_CONFIG), encoding="utf-8")
        proc = _run(
            [binary, "run", "--agent", OPENCODE_AGENT, *opencode_args()],
            prompt,
            binary,
            tmp,
        )
    if proc.returncode != 0:
        raise AssistError(f"exit {proc.returncode}: {_tail(proc.stderr or proc.stdout)}")
    if not proc.stdout.strip():
        raise AssistError("empty reply")
    return proc.stdout


RUNNERS = {"codex": run_codex, "claude": run_claude, "opencode": run_opencode}


def backend_order(requested: str) -> list[str]:
    now = time.time()
    # A backend that just failed its probe goes last, so the rest of a long run is not spent waiting on it.
    def by_health(names: list[str]) -> list[str]:
        return sorted(names, key=lambda name: _down_until.get(name, 0) > now)

    if requested in RUNNERS:
        # An explicitly requested backend stays first even when marked down: the caller asked for it.
        return [requested] + by_health([name for name in RUNNERS if name != requested])
    return by_health([name for name in config.ASSIST_BACKENDS if name in RUNNERS])


def _probe(name: str, abort: threading.Event, finished: threading.Event) -> None:
    if finished.wait(PROBE_AFTER_SECONDS):
        return
    _ctx.timeout = PROBE_TIMEOUT_SECONDS
    _ctx.abort = None
    try:
        reply = RUNNERS[name](PROBE_PROMPT)
        healthy = bool(reply.strip())
    except AssistError as exc:
        logger.warning("assist backend %s failed its health probe: %s", name, exc)
        healthy = False
    if healthy or finished.is_set():
        return
    _down_until[name] = time.time() + BACKEND_DOWN_SECONDS
    abort.set()


def _execute(
    job: AssistJob, backends: list[str], prompt: str, overrides: dict[str, str] | None = None
) -> None:
    with _run_slots:
        job.status = "running"
        errors: list[str] = []
        for name in backends:
            job.backend = name
            job.attempt_started_at = time.time()
            abort, finished = threading.Event(), threading.Event()
            _ctx.abort, _ctx.timeout = abort, None
            # Only the requested backend (first in the order) gets the override; a fallback runs its own default.
            _ctx.overrides = overrides if name == backends[0] else None
            # A model override means a deliberate (often slow) run; the health probe would cut it off.
            if not _ctx.overrides:
                threading.Thread(target=_probe, args=(name, abort, finished), daemon=True).start()
            try:
                job.reply = RUNNERS[name](prompt)
                job.status = "done"
                _record(job, name, "ok", None)
                return
            except AssistError as exc:
                logger.warning("assist backend %s failed: %s", name, exc)
                errors.append(f"{name}: {exc}")
                _record(job, name, "failed", str(exc))
            finally:
                finished.set()
        job.error = "; ".join(errors) or "no assist backend configured"
        job.status = "error"


def _record(job: AssistJob, name: str, outcome: str, detail: str | None) -> None:
    started = job.attempt_started_at or time.time()
    model, effort = _model_and_effort(name)
    attempt = {
        "backend": name,
        "model": model or None,
        "effort": effort or None,
        "outcome": outcome,
        "detail": detail,
        "seconds": round(time.time() - started),
    }
    job.attempts.append(attempt)
    _log_call(job, attempt)


def _log_call(job: AssistJob, attempt: dict) -> None:
    """Append one line per finished attempt to the call log, so a bad extra can be traced to the model that wrote
    it (match on time and label). Best-effort: a log failure never fails the call."""
    entry = {
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "job": job.id,
        "label": job.label,
        "promptChars": job.prompt_chars,
        **attempt,
    }
    try:
        path = Path(config.ASSIST_CALL_LOG_PATH)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError as exc:
        logger.warning("could not write the assist call log: %s", exc)


def _sweep() -> None:
    cutoff = time.time() - JOB_RETENTION_SECONDS
    for job_id in [j.id for j in _jobs.values() if j.created_at < cutoff]:
        _jobs.pop(job_id, None)


def submit(
    prompt: str,
    backend: str = "auto",
    model: str | None = None,
    effort: str | None = None,
    label: str | None = None,
) -> AssistJob:
    job = AssistJob(id=uuid.uuid4().hex, label=label, prompt_chars=len(prompt))
    with _jobs_lock:
        _sweep()
        _jobs[job.id] = job
    threading.Thread(
        target=_execute,
        args=(job, backend_order(backend), prompt, {k: v for k, v in (("model", model), ("effort", effort)) if v}),
        daemon=True,
    ).start()
    return job


def get(job_id: str) -> AssistJob | None:
    with _jobs_lock:
        return _jobs.get(job_id)
