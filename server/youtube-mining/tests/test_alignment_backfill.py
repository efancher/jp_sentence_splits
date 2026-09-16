"""app/alignment_backfill.py + its /alignment-backfill/jobs routes.

subprocess.Popen is faked so this runs without node/tsx/network — only the
job lifecycle (thread, log tail, status transitions, HTTP shape) is under
test, matching the script's real behavior via a stand-in process.
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app import alignment_backfill
from app.main import app

client = TestClient(app)


class _FakeProc:
    def __init__(self, lines: list[str], returncode: int = 0):
        self.stdout = iter(lines)
        self._returncode = returncode

    def wait(self) -> int:
        return self._returncode


@pytest.fixture()
def fake_popen(monkeypatch):
    calls: list[list[str]] = []

    def _make(lines: list[str], returncode: int = 0):
        def _popen(args, **kwargs):
            calls.append(args)
            return _FakeProc(lines, returncode)

        monkeypatch.setattr(alignment_backfill.subprocess, "Popen", _popen)
        return calls

    return _make


def _wait_for(job_id: str, *, timeout: float = 2.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = alignment_backfill.get(job_id)
        if job.status != "running":
            return job
        time.sleep(0.01)
    raise TimeoutError(f"job {job_id} did not finish")


def test_job_runs_to_completion_and_tracks_log(fake_popen):
    fake_popen(["3 recording(s); 1 already aligned, 2 to do\n", "Done. 2 stored, 0 failed.\n"])
    job = alignment_backfill.start(None)
    finished = _wait_for(job.id)
    assert finished.status == "done"
    assert finished.message == "Done. 2 stored, 0 failed."
    assert finished.log == [
        "3 recording(s); 1 already aligned, 2 to do",
        "Done. 2 stored, 0 failed.",
    ]


def test_job_scoped_to_book_passes_flag(fake_popen):
    calls = fake_popen(["Scoped to book abc123.\n", "Done. 0 stored, 0 failed.\n"])
    job = alignment_backfill.start("abc123")
    _wait_for(job.id)
    assert calls[0][-2:] == ["--book", "abc123"]


def test_job_reports_nonzero_exit_as_error(fake_popen):
    fake_popen(["Supabase sign-in failed: bad credentials\n"], returncode=1)
    job = alignment_backfill.start(None)
    finished = _wait_for(job.id)
    assert finished.status == "error"
    assert "exit 1" in finished.message


def test_get_unknown_job_raises():
    with pytest.raises(alignment_backfill.JobNotFoundError):
        alignment_backfill.get("does-not-exist")


def test_log_tail_is_capped(fake_popen):
    lines = [f"line {i}\n" for i in range(50)]
    fake_popen(lines)
    job = alignment_backfill.start(None)
    finished = _wait_for(job.id)
    assert len(finished.log) == alignment_backfill._LOG_TAIL
    assert finished.log[-1] == "line 49"


def test_create_and_poll_via_http(fake_popen):
    fake_popen(["Done. 1 stored, 0 failed.\n"])
    resp = client.post("/alignment-backfill/jobs", json={"bookId": "book-1"})
    assert resp.status_code == 200
    job_id = resp.json()["jobId"]

    finished = _wait_for(job_id)
    assert finished.status == "done"

    status_resp = client.get(f"/alignment-backfill/jobs/{job_id}")
    assert status_resp.status_code == 200
    body = status_resp.json()
    assert body["status"] == "done"
    assert body["message"] == "Done. 1 stored, 0 failed."


def test_poll_unknown_job_is_404():
    resp = client.get("/alignment-backfill/jobs/does-not-exist")
    assert resp.status_code == 404
