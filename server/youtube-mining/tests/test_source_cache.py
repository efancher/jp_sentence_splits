"""app/source_cache.py + the /source-audio endpoints."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import config, jobs, source_cache, youtube
from app.main import app


def _ffmpeg_available() -> bool:
    try:
        subprocess.run(["ffmpeg", "-version"], check=True, capture_output=True)
        subprocess.run(["ffprobe", "-version"], check=True, capture_output=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


pytestmark = pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg/ffprobe required")


def _make_m4a(path: Path, seconds: float) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y", "-nostdin",
            "-f", "lavfi", "-t", f"{seconds}", "-i", "sine=frequency=330:r=16000",
            "-c:a", "aac", "-b:a", "96k", str(path),
        ],
        check=True,
        capture_output=True,
    )


@pytest.fixture(autouse=True)
def _cache_root(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SOURCE_CACHE_ROOT", str(tmp_path / "cache"))
    monkeypatch.setattr(config, "SOURCE_CACHE_MAX_BYTES", 10 * 1024 * 1024)


def test_store_get_roundtrip(tmp_path):
    src = tmp_path / "src.m4a"
    _make_m4a(src, 3.0)

    assert source_cache.get("vid00000001") is None
    stored = source_cache.store("vid00000001", src)
    assert stored.is_file() and stored.stat().st_size > 0

    got = source_cache.get("vid00000001")
    assert got == stored
    duration_ms, size_bytes = source_cache.info(got)
    assert 2500 <= duration_ms <= 3500
    assert size_bytes == stored.stat().st_size


def test_store_is_smaller_than_source(tmp_path):
    src = tmp_path / "src.m4a"
    _make_m4a(src, 8.0)
    stored = source_cache.store("vid00000002", src)
    assert stored.stat().st_size < src.stat().st_size


def test_evict_lru(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SOURCE_CACHE_MAX_BYTES", 1)  # force eviction
    src = tmp_path / "src.m4a"
    _make_m4a(src, 2.0)
    first = source_cache.store("vidoldest001", src)
    second = source_cache.store("vidnewest001", src)
    assert not first.exists()  # oldest evicted
    assert second.exists()  # newest kept even though still over cap


def test_get_touches_mtime_for_lru(tmp_path, monkeypatch):
    src = tmp_path / "src.m4a"
    _make_m4a(src, 3.0)
    a = source_cache.store("vidaaaaaaa01", src)
    b = source_cache.store("vidbbbbbbb01", src)
    one = a.stat().st_size
    # Re-access A so B is now the least-recently-modified file.
    source_cache.get("vidaaaaaaa01")
    # Cap fits two files but not three → exactly one eviction on the next store.
    monkeypatch.setattr(config, "SOURCE_CACHE_MAX_BYTES", int(one * 2.5))
    c = source_cache.store("vidccccccc01", src)
    assert not b.exists()  # least recently used
    assert a.exists() and c.exists()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SOURCE_CACHE_ROOT", str(tmp_path / "epcache"))

    def fake_fetch_audio(url: str, job_dir: Path) -> Path:
        out = job_dir / "source_audio.m4a"
        _make_m4a(out, 5.0)
        return out

    monkeypatch.setattr(youtube, "fetch_audio", fake_fetch_audio)
    # exit_node is a no-op unless MINING_EXIT_NODE is set; leave it.
    return TestClient(app)


URL = "https://www.youtube.com/watch?v=abcdefghij0"


def test_ensure_endpoint_then_fetch_and_clip(client: TestClient):
    ensure = client.post("/source-audio", json={"url": URL})
    assert ensure.status_code == 200, ensure.text
    body = ensure.json()
    assert body["videoId"] == "abcdefghij0"
    assert 4500 <= body["durationMs"] <= 5500
    assert body["sizeBytes"] > 0

    got = client.get("/source-audio/abcdefghij0")
    assert got.status_code == 200
    assert got.headers["content-type"].startswith("audio/ogg")
    assert len(got.content) == body["sizeBytes"]

    clip_resp = client.post(
        "/source-audio/clip",
        json={"url": URL, "cuts": [{"startMs": 1000, "endMs": 2500}]},
    )
    assert clip_resp.status_code == 200, clip_resp.text
    clips = clip_resp.json()["clips"]
    assert len(clips) == 1
    assert clips[0]["durationMs"] > 0
    assert clips[0]["audioBase64"]


def test_get_missing_source_audio_404(client: TestClient):
    assert client.get("/source-audio/notcachedxx").status_code == 404
