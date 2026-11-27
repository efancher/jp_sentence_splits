"""app/boundary_backfill.py + routes, and /source-audio/clip refinement.

Popen, the source cache and the aligner are faked: only the job lifecycle and
the refinement wiring are under test.
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app import boundary_backfill, boundary_refine, clip, main, source_cache
from app.main import app

client = TestClient(app)


class _FakeProc:
    def __init__(self, lines, returncode=0):
        self.stdout = iter(lines)
        self._returncode = returncode

    def wait(self):
        return self._returncode


def _wait_for(job_id, timeout=2.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = boundary_backfill.get(job_id)
        if job.status != "running":
            return job
        time.sleep(0.01)
    raise TimeoutError(job_id)


@pytest.fixture()
def fake_popen(monkeypatch):
    calls = []

    def _popen(args, **kwargs):
        calls.append((args, kwargs))
        return _FakeProc(["Preview: 2 would be replaced\n"])

    monkeypatch.setattr(boundary_backfill.subprocess, "Popen", _popen)
    return calls


def test_preview_job_has_no_apply_flag_and_targets_self(fake_popen):
    job = boundary_backfill.start("book-1", apply=False)
    finished = _wait_for(job.id)
    args, kwargs = fake_popen[0]
    assert finished.status == "done"
    assert "--apply" not in args
    assert args[-2:] == ["--book", "book-1"]
    assert kwargs["env"]["MINING_API_BASE"] == boundary_backfill.SELF_API_BASE


def test_apply_job_passes_apply_flag(fake_popen):
    job = boundary_backfill.start("book-1", apply=True)
    _wait_for(job.id)
    assert "--apply" in fake_popen[0][0]


def test_routes_require_book_and_report_status(fake_popen):
    assert client.post("/boundary-backfill/jobs", json={}).status_code == 422
    resp = client.post("/boundary-backfill/jobs", json={"bookId": "b", "apply": True})
    assert resp.status_code == 200
    job_id = resp.json()["jobId"]
    _wait_for(job_id)
    body = client.get(f"/boundary-backfill/jobs/{job_id}").json()
    assert body["status"] == "done"
    assert client.get("/boundary-backfill/jobs/nope").status_code == 404


def test_source_clip_refines_when_text_given(monkeypatch, tmp_path):
    monkeypatch.setattr(source_cache, "ensure", lambda url: tmp_path / "s.opus")
    monkeypatch.setattr(clip, "probe_duration_ms", lambda p: 60_000)
    monkeypatch.setattr(
        clip, "clip_audio", lambda s, o, **k: o.write_bytes(b"x") or k["end_ms"] - k["start_ms"]
    )
    seen = {}

    def fake_refine(path, text, start, end, **kw):
        seen["args"] = (text, start, end)
        return boundary_refine.RefineResult("refined", 2300, 5200, [], 300, 200)

    monkeypatch.setattr(main.boundary_refine, "refine_span", fake_refine)
    resp = client.post(
        "/source-audio/clip",
        json={"url": "https://x/y", "cuts": [{"startMs": 2000, "endMs": 5000, "japanese": "今日は晴れです"}]},
    )
    assert resp.status_code == 200
    got = resp.json()["clips"][0]
    assert seen["args"] == ("今日は晴れです", 2000, 5000)
    assert (got["cutStartMs"], got["cutEndMs"]) == (2300, 5200)
    assert got["boundaryRefine"]["status"] == "refined"
    assert got["boundaryRefine"]["shiftStartMs"] == 300


def test_source_clip_without_text_is_unrefined(monkeypatch, tmp_path):
    monkeypatch.setattr(source_cache, "ensure", lambda url: tmp_path / "s.opus")
    monkeypatch.setattr(clip, "probe_duration_ms", lambda p: 60_000)
    monkeypatch.setattr(
        clip, "clip_audio", lambda s, o, **k: o.write_bytes(b"x") or k["end_ms"] - k["start_ms"]
    )
    resp = client.post(
        "/source-audio/clip", json={"url": "https://x/y", "cuts": [{"startMs": 2000, "endMs": 5000}]}
    )
    got = resp.json()["clips"][0]
    assert got["boundaryRefine"] is None and got["cutStartMs"] is None
