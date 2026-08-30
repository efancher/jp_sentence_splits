"""Persistent per-video source-audio cache.

A mining job's scratch dir — and the source audio in it — is swept after
`JOB_TTL_SECONDS`. But re-cutting a book's reference audio later (a
re-segment, a boundary nudge, an audio-repair pass) wants the *original*
source, not a lossy concatenation of fragment clips. That fragment-concat
path is how `applyResegmentation` works today and is what produced the
2026-08-30 truncation bug (`concatCut`'s no-padding assumption).

So on a successful download we also stash a compressed Opus copy here,
keyed by video id, outside the sweep. It's small (~32 kbps mono ≈
250 KB/min) so dozens of books stay well under a GB; an LRU cap
(`SOURCE_CACHE_MAX_BYTES`) evicts the oldest by mtime if it grows past.
Re-fetching an evicted/absent source is cheap now that YouTube access
works again (Tailscale exit node, see `app/exit_node.py`).
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from pathlib import Path

from app import clip, config, exit_node, youtube

logger = logging.getLogger("youtube_mining_api.source_cache")

MIME_TYPE = "audio/ogg"
_EXT = ".opus"


def _root() -> Path:
    path = Path(config.SOURCE_CACHE_ROOT)
    path.mkdir(parents=True, exist_ok=True)
    return path


def path_for(video_id: str) -> Path:
    return _root() / f"{video_id}{_EXT}"


def get(video_id: str) -> Path | None:
    """Cached path for `video_id`, or None. Touches mtime so `get` counts as
    a use for LRU eviction."""
    path = path_for(video_id)
    if not path.is_file() or path.stat().st_size == 0:
        return None
    os.utime(path, None)
    return path


def _transcode_to_opus(src: Path, dest: Path) -> None:
    tmp = dest.with_name(f".{dest.name}.{os.getpid()}.tmp")
    subprocess.run(
        [
            "ffmpeg", "-y", "-nostdin", "-i", str(src),
            "-vn", "-ac", "1", "-c:a", "libopus",
            "-b:a", f"{config.SOURCE_CACHE_OPUS_KBPS}k",
            "-f", "opus", str(tmp),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    os.replace(tmp, dest)


def _evict_lru(protect: Path | None = None) -> None:
    """Delete least-recently-modified cache files until the directory is under
    `SOURCE_CACHE_MAX_BYTES`. `protect` (the file the caller just wrote) is
    never evicted, even if it alone exceeds the cap."""
    files = sorted(
        (p for p in _root().glob(f"*{_EXT}") if p.is_file()),
        key=lambda p: p.stat().st_mtime,
    )
    total = sum(p.stat().st_size for p in files)
    cap = config.SOURCE_CACHE_MAX_BYTES
    for path in files:
        if total <= cap:
            break
        if protect is not None and path.samefile(protect):
            continue
        size = path.stat().st_size
        try:
            path.unlink()
            total -= size
            logger.info("Evicted %s from source cache (%d bytes)", path.name, size)
        except OSError:
            pass


def store(video_id: str, source_audio_path: Path) -> Path:
    """Transcode `source_audio_path` to Opus and cache it under `video_id`.
    Idempotent — a re-store overwrites. Runs LRU eviction afterwards."""
    dest = path_for(video_id)
    _transcode_to_opus(source_audio_path, dest)
    _evict_lru(protect=dest)
    return dest


def ensure(url: str) -> Path:
    """Cached Opus path for `url`'s video, downloading + caching it first if
    absent. Routes the download through the Tailscale exit node."""
    video_id = youtube.extract_video_id(url)
    if not video_id:
        raise ValueError(f"Could not extract a video id from {url!r}")
    cached = get(video_id)
    if cached is not None:
        return cached
    with tempfile.TemporaryDirectory(prefix="source-fetch-") as tmp:
        try:
            with exit_node.routed_for_download():
                downloaded = youtube.fetch_audio(url, Path(tmp))
        except Exception as exc:  # noqa: BLE001 - yt_dlp.DownloadError et al.
            raise RuntimeError(f"Source download failed: {exc}") from exc
        peak_db = clip.probe_max_volume_db(downloaded)
        if peak_db < config.SILENT_SOURCE_MAX_DB:
            raise RuntimeError(
                f"Downloaded source audio is silent (peak {peak_db:.0f} dBFS)."
            )
        return store(video_id, downloaded)


def info(path: Path) -> tuple[int, int]:
    """(durationMs, sizeBytes) for a cached file."""
    return clip.probe_duration_ms(path), path.stat().st_size
