"""POST/GET /assist-runs — the TS runner subprocess is faked, so this covers
routing, resume-from-disk, the interrupted-after-restart report and cancel."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import assist_run, config
from app.main import app

BODY = {
    "runId": "job_1",
    "transcript": [{"text": "あ", "startMs": 0, "endMs": 1000}],
    "options": {"structure": True},
}


class FakeProc:
    """A live process: poll() is None until terminated."""

    def __init__(self) -> None:
        self.returncode: int | None = None
        self.terminated = False

    def poll(self) -> int | None:
        return self.returncode

    def wait(self, timeout: float | None = None) -> int:
        if self.returncode is None:
            self.returncode = 0
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = -15

    def kill(self) -> None:
        self.returncode = -9


class NoThread:
    def __init__(self, **kwargs: object) -> None:
        pass

    def start(self) -> None:
        pass


@pytest.fixture()
def spawned() -> list[list[str]]:
    return []


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, spawned: list[list[str]]) -> TestClient:
    monkeypatch.setattr(config, "JOBS_ROOT", str(tmp_path))
    monkeypatch.setattr(assist_run, "_procs", {})

    def fake_popen(args: list[str], **kwargs: object) -> FakeProc:
        spawned.append(args)
        return FakeProc()

    monkeypatch.setattr(assist_run.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(assist_run.threading, "Thread", NoThread)
    return TestClient(app)


def test_start_writes_spec_and_reports_running(
    client: TestClient, tmp_path: Path, spawned: list[list[str]]
) -> None:
    body = client.post("/assist-runs", json=BODY).json()
    assert body["status"] == "running"
    spec = json.loads((tmp_path / "assist-runs" / "job_1" / "spec.json").read_text())
    assert spec["options"]["structure"] is True and spec["transcript"][0]["text"] == "あ"
    assert len(spawned) == 1


def test_concurrency_is_clamped_to_the_box_cap(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(config, "ASSIST_MAX_CONCURRENCY", 3)
    assert client.post("/assist-runs", json={**BODY, "concurrency": 5}).status_code == 200
    spec = json.loads((tmp_path / "assist-runs" / "job_1" / "spec.json").read_text())
    assert spec["concurrency"] == 3
    assert client.post("/assist-runs", json={**BODY, "runId": "job_2"}).status_code == 200
    spec = json.loads((tmp_path / "assist-runs" / "job_2" / "spec.json").read_text())
    assert spec["concurrency"] == 1


def test_start_is_idempotent_while_live(client: TestClient, spawned: list[list[str]]) -> None:
    client.post("/assist-runs", json=BODY)
    client.post("/assist-runs", json=BODY)
    assert len(spawned) == 1


def test_progress_fields_come_from_state(client: TestClient, tmp_path: Path) -> None:
    client.post("/assist-runs", json=BODY)
    state_path = tmp_path / "assist-runs" / "job_1" / "state.json"
    state = json.loads(state_path.read_text())
    state.update(
        phase="sentences",
        progress="Sentences: part 2 of 3",
        segmentReplies=["a", "b", None],
    )
    state_path.write_text(json.dumps(state))
    body = client.get("/assist-runs/job_1").json()
    assert body["progress"] == "Sentences: part 2 of 3"
    assert (body["segmentsDone"], body["segmentsTotal"]) == (2, 3)


def test_running_state_without_process_reports_interrupted_and_resumes(
    client: TestClient, spawned: list[list[str]]
) -> None:
    client.post("/assist-runs", json=BODY)
    assist_run._procs.clear()  # service restarted
    body = client.get("/assist-runs/job_1").json()
    assert body["status"] == "interrupted"
    assert "resume" in body["failure"]
    resumed = client.post("/assist-runs", json=BODY).json()
    assert resumed["status"] == "running"
    assert len(spawned) == 2


def test_unknown_and_invalid_ids(client: TestClient) -> None:
    assert client.get("/assist-runs/nope").status_code == 404
    assert client.post("/assist-runs", json={**BODY, "runId": "a/b"}).status_code == 400


def test_cancel_terminates_and_delete_discards(client: TestClient) -> None:
    client.post("/assist-runs", json=BODY)
    proc = assist_run._procs["job_1"]
    assert client.post("/assist-runs/job_1/cancel").status_code == 204
    assert proc.terminated
    assert client.delete("/assist-runs/job_1").status_code == 204
    assert client.get("/assist-runs/job_1").status_code == 404


BOOK_BODY = {
    "runId": "book-extras-b1",
    "sentences": [{"handle": 1, "japanese": "猫が好き。", "translation": "I like cats."}],
    "selection": {"walkthroughs": [1]},
}


def test_book_extras_run_stores_spec_and_returns_pieces(client: TestClient, tmp_path: Path) -> None:
    assert client.post("/assist-runs", json=BOOK_BODY).json()["status"] == "running"
    run_dir = tmp_path / "assist-runs" / "book-extras-b1"
    spec = json.loads((run_dir / "spec.json").read_text())
    assert spec["selection"] == {"walkthroughs": [1]} and spec["sentences"][0]["handle"] == 1
    state = json.loads((run_dir / "state.json").read_text())
    state["extraReplies"] = {"walkthroughs:1-1": "{}"}
    (run_dir / "state.json").write_text(json.dumps(state))
    body = client.get("/assist-runs/book-extras-b1").json()
    assert body["extraReplies"] == {"walkthroughs:1-1": "{}"}
    assert body["bookSentences"] == BOOK_BODY["sentences"]
    assert body["selection"] == {"walkthroughs": [1]} and body["sentenceCount"] == len(spec["sentences"])


def test_book_extras_run_keeps_the_grammar_pattern_list_in_the_spec(client: TestClient, tmp_path: Path) -> None:
    patterns = [{"id": "p1", "name": "〜ている", "template": "V-て + いる", "aliases": ["〜てる"]}]
    body = {**BOOK_BODY, "runId": "book-extras-b2", "selection": {"grammar": [1]}, "grammarPatterns": patterns}
    assert client.post("/assist-runs", json=body).json()["status"] == "running"
    spec = json.loads((tmp_path / "assist-runs" / "book-extras-b2" / "spec.json").read_text())
    assert spec["selection"] == {"grammar": [1]} and spec["grammarPatterns"] == patterns


def test_run_needs_a_transcript_or_book_sentences(client: TestClient) -> None:
    assert client.post("/assist-runs", json={"runId": "x"}).status_code == 422
    assert client.post("/assist-runs", json={**BOOK_BODY, "selection": {}}).status_code == 422
