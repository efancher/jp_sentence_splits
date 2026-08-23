"""yt-dlp wrapper, simplified from shadowmine/youtube.py.

The original CLI cached downloads across CLI invocations by video id under
a persistent `projects/` directory. This service has no such concept —
every job gets a fresh scratch directory and always downloads — so the
cache-reuse bookkeeping (FetchResult/SubtitleResult/find_cached_source_audio)
is dropped; everything else (yt-dlp options, subtitle languages, audio
postprocessing) is unchanged.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from app import config
from app.models import SourceInfo

YOUTUBE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")


def extract_video_id(url_or_id: str) -> str | None:
    value = url_or_id.strip()
    if YOUTUBE_ID_RE.fullmatch(value):
        return value
    patterns = [
        r"(?:v=|/embed/|/shorts/|/live/|youtu\.be/)([a-zA-Z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, value)
        if match:
            return match.group(1)
    return None


def _ydl(opts: dict[str, Any] | None = None):
    from yt_dlp import YoutubeDL

    base = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
    }
    if config.YTDLP_COOKIES_FILE:
        base["cookiefile"] = config.YTDLP_COOKIES_FILE
    if opts:
        base.update(opts)
    return YoutubeDL(base)


def inspect_url(url: str) -> dict[str, Any]:
    with _ydl({"skip_download": True}) as ydl:
        info = ydl.extract_info(url, download=False)
        return ydl.sanitize_info(info)


def info_to_source(info: dict[str, Any]) -> SourceInfo:
    video_id = str(info.get("id") or "")
    if not video_id:
        raise ValueError("yt-dlp info dict is missing id")
    duration = info.get("duration")
    duration_ms = int(float(duration) * 1000) if duration is not None else None
    return SourceInfo(
        id=f"source-{video_id}",
        url=str(
            info.get("webpage_url")
            or info.get("original_url")
            or f"https://www.youtube.com/watch?v={video_id}"
        ),
        videoId=video_id,
        title=str(info.get("title") or video_id),
        channel=info.get("channel") or info.get("uploader"),
        durationMs=duration_ms,
    )


def fetch_audio(url: str, job_dir: Path) -> Path:
    """Download source audio into job_dir, returning the resulting file path."""
    outtmpl = str(job_dir / "source_audio.%(ext)s")
    opts = {
        "format": "bestaudio/best",
        "outtmpl": outtmpl,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "m4a",
                "preferredquality": "192",
            }
        ],
        "overwrites": True,
    }
    with _ydl(opts) as ydl:
        ydl.download([url])

    audio = job_dir / "source_audio.m4a"
    if audio.exists():
        return audio
    matches = sorted(job_dir.glob("source_audio.*"))
    if not matches:
        raise FileNotFoundError("Download finished but source_audio.* was not created")
    return matches[0]


def download_subtitles(
    url: str, job_dir: Path, langs: list[str] | None = None
) -> list[Path]:
    """Download JA (manual+auto) and EN (manual+auto) subtitle tracks.

    Missing tracks are allowed; yt-dlp writes whichever are available.
    """
    subtitle_dir = job_dir / "subtitles"
    subtitle_dir.mkdir(parents=True, exist_ok=True)
    languages = langs or ["ja", "ja-orig", "en", "en-orig"]
    opts = {
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": languages,
        "subtitlesformat": "vtt",
        "outtmpl": str(subtitle_dir / "%(id)s.%(ext)s"),
        "overwrites": True,
    }
    with _ydl(opts) as ydl:
        ydl.download([url])
    return sorted(subtitle_dir.glob("*.vtt"))
