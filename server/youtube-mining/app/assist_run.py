"""Server-side Quick import "Send to assistant" runs.

The pipeline (segment+translate in parts, then every ticked extra) lives in
TypeScript (`src/lib/assistRun.ts`, shared with the tests); this module just
spawns `scripts/assist-run.ts` as a subprocess per run and exposes its state
so the browser can close and come back. Each run has a directory under
`<JOBS_ROOT>/assist-runs/<run id>/` holding `spec.json` (input) and
`state.json` (the script rewrites it after every finished piece). Because the
state is on disk, a service restart only interrupts the in-flight piece: the
run reports `interrupted` and a new POST with the same id resumes it.

The run id is the mining job id, so the page can find its run after a reload.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from app import config
from app.alignment_backfill import NODE_BINARY, REPO_ROOT, TSX_CLI

logger = logging.getLogger("youtube_mining_api.assist_run")

SCRIPT_PATH = REPO_ROOT / "scripts" / "assist-run.ts"
RETENTION_SECONDS = 7 * 24 * 60 * 60
CANCEL_GRACE_SECONDS = 15
_RUN_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")

_procs: dict[str, subprocess.Popen[bytes]] = {}
_lock = threading.Lock()


class InvalidRunIdError(ValueError):
    pass


def _root() -> Path:
    return Path(config.JOBS_ROOT) / "assist-runs"


def _run_dir(run_id: str) -> Path:
    if not _RUN_ID_RE.match(run_id):
        raise InvalidRunIdError(run_id)
    return _root() / run_id


def _read_state(run_dir: Path) -> dict[str, Any] | None:
    try:
        return json.loads((run_dir / "state.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_state(run_dir: Path, state: dict[str, Any]) -> None:
    tmp = run_dir / "state.json.tmp"
    tmp.write_text(json.dumps(state), encoding="utf-8")
    os.replace(tmp, run_dir / "state.json")


def _mark(run_dir: Path, status: str, failure: str | None = None) -> None:
    state = _read_state(run_dir)
    if state is None or state.get("status") != "running":
        return
    state["status"] = status
    state["progress"] = ""
    if failure:
        state["failure"] = failure
    state["updatedAt"] = int(time.time() * 1000)
    _write_state(run_dir, state)


def _sweep() -> None:
    root = _root()
    if not root.is_dir():
        return
    cutoff = time.time() - RETENTION_SECONDS
    for child in root.iterdir():
        try:
            if child.is_dir() and child.name not in _procs and child.stat().st_mtime < cutoff:
                shutil.rmtree(child, ignore_errors=True)
        except OSError:
            continue


def _watch(run_id: str, proc: subprocess.Popen[bytes], run_dir: Path) -> None:
    returncode = proc.wait()
    with _lock:
        if _procs.get(run_id) is proc:
            _procs.pop(run_id, None)
    # The script writes its own terminal status; "running" here means it died
    # without doing so (killed, OOM, crash) — leave it resumable.
    _mark(run_dir, "interrupted", f"The run stopped unexpectedly (exit {returncode}).")


def is_active(run_id: str) -> bool:
    with _lock:
        proc = _procs.get(run_id)
        return proc is not None and proc.poll() is None


def start(run_id: str, spec: dict[str, Any]) -> None:
    """Start (or resume) a run. No-op while one for this id is already live."""
    run_dir = _run_dir(run_id)
    with _lock:
        existing = _procs.get(run_id)
        if existing is not None and existing.poll() is None:
            return
        _sweep()
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "spec.json").write_text(json.dumps(spec), encoding="utf-8")
        state = _read_state(run_dir)
        if state is not None:
            state["status"] = "running"
            state["failure"] = None
            state["progress"] = "Starting…"
            state["updatedAt"] = int(time.time() * 1000)
            _write_state(run_dir, state)
        else:
            _write_state(
                run_dir,
                {
                    "status": "running",
                    "phase": None,
                    "progress": "Starting…",
                    "failure": None,
                    "segmentReplies": [],
                    "extraReplies": {},
                    "sentencesReply": None,
                    "extras": None,
                    "updatedAt": int(time.time() * 1000),
                },
            )
        env = dict(os.environ)
        env["MINING_API_SELF_BASE"] = f"http://127.0.0.1:{os.environ.get('MINING_API_PORT', '8003')}"
        proc = subprocess.Popen(
            [NODE_BINARY, str(TSX_CLI), str(SCRIPT_PATH), "--dir", str(run_dir)],
            cwd=REPO_ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        _procs[run_id] = proc
    threading.Thread(target=_watch, args=(run_id, proc, run_dir), daemon=True).start()


def get(run_id: str) -> dict[str, Any] | None:
    run_dir = _run_dir(run_id)
    state = _read_state(run_dir)
    if state is None:
        return None
    if state.get("status") == "running" and not is_active(run_id):
        # Service restarted (or the process vanished) mid-run.
        _mark(run_dir, "interrupted", "The run was interrupted — resume to continue.")
        state = _read_state(run_dir) or state
    return state


def cancel(run_id: str) -> bool:
    with _lock:
        proc = _procs.get(run_id)
    if proc is None or proc.poll() is not None:
        return False
    proc.terminate()
    try:
        proc.wait(timeout=CANCEL_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        proc.kill()
        _mark(_run_dir(run_id), "cancelled")
    return True


def discard(run_id: str) -> None:
    """Forget a run (stops it first). Used when the user starts over."""
    cancel(run_id)
    shutil.rmtree(_run_dir(run_id), ignore_errors=True)
