"""Durable Supabase Storage copy of the per-video source-audio cache.

The local cache (`source_cache`) is LRU-evicted and re-fetching from YouTube
depends on the bot-blocked box. Every cached Opus file is mirrored to a
private `source-audio` bucket, and a cache miss tries the bucket before
YouTube. All of it is best-effort and a no-op unless
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import httpx

from app import config

logger = logging.getLogger("youtube_mining_api.source_backup")

_TIMEOUT = 120.0


def enabled() -> bool:
    return bool(config.SUPABASE_URL and config.SUPABASE_SERVICE_ROLE_KEY)


def _object_url(video_id: str) -> str:
    return f"{config.SUPABASE_URL}/storage/v1/object/{config.SOURCE_BACKUP_BUCKET}/{video_id}.opus"


def _headers(**extra: str) -> dict[str, str]:
    key = config.SUPABASE_SERVICE_ROLE_KEY or ""
    return {"Authorization": f"Bearer {key}", "apikey": key, **extra}


def upload(video_id: str, path: Path) -> bool:
    """Mirror `path` to the bucket (upsert). Never raises."""
    if not enabled():
        return False
    try:
        response = httpx.post(
            _object_url(video_id),
            headers=_headers(**{"Content-Type": "audio/ogg", "x-upsert": "true"}),
            content=path.read_bytes(),
            timeout=_TIMEOUT,
        )
        response.raise_for_status()
        return True
    except Exception as exc:  # noqa: BLE001 - backup must never break the cache
        logger.warning("Source backup upload failed for %s: %s", video_id, exc)
        return False


def restore(video_id: str, dest: Path) -> bool:
    """Download the bucket copy to `dest`. False if absent or on any error."""
    if not enabled():
        return False
    tmp = dest.with_name(f".{dest.name}.{os.getpid()}.restore")
    try:
        response = httpx.get(_object_url(video_id), headers=_headers(), timeout=_TIMEOUT)
        if response.status_code in (400, 404):
            return False
        response.raise_for_status()
        if not response.content:
            return False
        tmp.write_bytes(response.content)
        os.replace(tmp, dest)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("Source backup restore failed for %s: %s", video_id, exc)
        tmp.unlink(missing_ok=True)
        return False


def backfill() -> dict[str, int]:
    """Upload every locally cached source to the bucket (idempotent upsert)."""
    uploaded = failed = 0
    for path in sorted(Path(config.SOURCE_CACHE_ROOT).glob("*.opus")):
        if upload(path.stem, path):
            uploaded += 1
        else:
            failed += 1
    return {"uploaded": uploaded, "failed": failed}


def status() -> dict[str, object]:
    """Reachability check for ops — never reveals the key."""
    if not enabled():
        return {"enabled": False}
    try:
        response = httpx.get(
            f"{config.SUPABASE_URL}/storage/v1/bucket/{config.SOURCE_BACKUP_BUCKET}",
            headers=_headers(),
            timeout=15.0,
        )
        return {"enabled": True, "ok": response.status_code == 200, "httpStatus": response.status_code}
    except Exception as exc:  # noqa: BLE001
        return {"enabled": True, "ok": False, "error": type(exc).__name__}


if __name__ == "__main__":
    import json
    import sys

    command = sys.argv[1] if len(sys.argv) > 1 else "status"
    if command == "backfill":
        print(json.dumps(backfill()))
    else:
        print(json.dumps(status()))
