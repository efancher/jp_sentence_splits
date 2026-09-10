"""Lightweight box-resource sampling behind the `/status` page.

A `systemd --user` timer runs ``python -m app.metrics`` every ~15 minutes to
append one JSON snapshot to ``config.METRICS_LOG``; the file is trimmed to
``config.METRICS_RETENTION_DAYS`` on each write. ``/status`` and
``/status.json`` read it back. No external calls — ``/proc``, ``statvfs``,
``systemctl --user show``, and ``os.walk`` over the cache dirs only.

Point of the page: notice a slow leak (the MFA aligner drifts from ~2.3 GB
to ~4.7 GB over a week) or a filling disk before it starts swapping / ENOSPC.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app import config


def _meminfo() -> dict[str, int]:
    out: dict[str, int] = {}
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            key, _, rest = line.partition(":")
            out[key.strip()] = int(rest.strip().split()[0]) * 1024  # kB -> bytes
    except OSError:
        pass
    return out


def _service_memory(unit: str) -> dict[str, object]:
    """cgroup memory + active state for a `systemd --user` unit."""
    try:
        raw = subprocess.run(
            ["systemctl", "--user", "show", unit,
             "-p", "MemoryCurrent", "-p", "ActiveState", "-p", "ActiveEnterTimestampMonotonic"],
            capture_output=True, text=True, timeout=5, check=False,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return {"mem": None, "active": None}
    props = dict(
        line.split("=", 1) for line in raw.splitlines() if "=" in line
    )
    mem_raw = props.get("MemoryCurrent", "")
    mem = int(mem_raw) if mem_raw.isdigit() else None
    active = props.get("ActiveState") == "active"
    uptime_s = None
    started = props.get("ActiveEnterTimestampMonotonic", "")
    if active and started.isdigit():
        uptime_s = max(0, int(time.clock_gettime(time.CLOCK_MONOTONIC) - int(started) / 1e6))
    return {"mem": mem, "active": active, "uptime_s": uptime_s}


def _dir_size(path: str) -> int:
    total = 0
    try:
        with os.scandir(path) as it:
            for entry in it:
                try:
                    if entry.is_file(follow_symlinks=False):
                        total += entry.stat(follow_symlinks=False).st_size
                    elif entry.is_dir(follow_symlinks=False):
                        total += _dir_size(entry.path)
                except OSError:
                    continue
    except OSError:
        return 0
    return total


def sample() -> dict:
    mem = _meminfo()
    disk = shutil.disk_usage("/")
    units = {}
    for spec in config.METRICS_UNITS:
        label, _, unit = spec.partition("=")
        if not unit:
            label, unit = spec, spec
        units[label] = _service_memory(unit)
    return {
        "t": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mem": {
            "total": mem.get("MemTotal", 0),
            "available": mem.get("MemAvailable", 0),
            "used": mem.get("MemTotal", 0) - mem.get("MemAvailable", 0),
        },
        "swap": {
            "total": mem.get("SwapTotal", 0),
            "used": mem.get("SwapTotal", 0) - mem.get("SwapFree", 0),
        },
        "disk": {"total": disk.total, "used": disk.used, "free": disk.free},
        "services": units,
        "caches": {
            "source_audio": _dir_size(config.SOURCE_CACHE_ROOT),
            "jobs": _dir_size(config.JOBS_ROOT),
        },
    }


def _log_path() -> Path:
    p = Path(config.METRICS_LOG)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def record() -> dict:
    snap = sample()
    path = _log_path()
    lines = []
    if path.exists():
        cutoff = datetime.now(timezone.utc) - timedelta(days=config.METRICS_RETENTION_DAYS)
        for line in path.read_text().splitlines():
            try:
                if datetime.fromisoformat(json.loads(line)["t"]) >= cutoff:
                    lines.append(line)
            except (ValueError, KeyError):
                continue
    lines.append(json.dumps(snap, separators=(",", ":")))
    path.write_text("\n".join(lines) + "\n")
    return snap


def load(days: int | None = None) -> list[dict]:
    path = Path(config.METRICS_LOG)
    if not path.exists():
        return []
    cutoff = None
    if days is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[dict] = []
    for line in path.read_text().splitlines():
        try:
            row = json.loads(line)
            when = datetime.fromisoformat(row["t"])  # also rejects rows with no "t"
        except (ValueError, KeyError, TypeError):
            continue
        if cutoff is None or when >= cutoff:
            out.append(row)
    return out


if __name__ == "__main__":
    snap = record()
    gb = 1024 ** 3
    print(
        f"{snap['t']}  mem {snap['mem']['used'] / gb:.1f}/{snap['mem']['total'] / gb:.1f} GB"
        f"  swap {snap['swap']['used'] / gb:.1f} GB"
        f"  disk {snap['disk']['used'] / gb:.1f}/{snap['disk']['total'] / gb:.1f} GB"
    )
    for label, svc in snap["services"].items():
        m = svc.get("mem")
        print(f"  {label}: {m / gb:.2f} GB" if m else f"  {label}: (inactive)")
