"""POST /assist + GET /assist/{id} — runners are monkeypatched, so this
covers routing, the codex->claude fallback and the no-retry error path."""

from __future__ import annotations

import threading
import time

import pytest
from fastapi.testclient import TestClient

from app import assist
from app.main import app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _wait(client: TestClient, assist_id: str) -> dict:
    for _ in range(100):
        body = client.get(f"/assist/{assist_id}").json()
        if body["status"] in ("done", "error"):
            return body
        time.sleep(0.02)
    raise AssertionError("assist job did not finish")


def test_codex_reply(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(assist.RUNNERS, "codex", lambda prompt: f"echo:{prompt}")
    assist_id = client.post("/assist", json={"prompt": "hi"}).json()["assistId"]
    body = _wait(client, assist_id)
    assert body["status"] == "done" and body["backend"] == "codex" and body["reply"] == "echo:hi"
    assert [a["outcome"] for a in body["attempts"]] == ["ok"]


def test_falls_back_to_claude_once_each(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def bad(prompt: str) -> str:
        calls.append("codex")
        raise assist.AssistError("rate limited")

    monkeypatch.setitem(assist.RUNNERS, "codex", bad)
    monkeypatch.setitem(assist.RUNNERS, "claude", lambda prompt: "from claude")
    body = _wait(client, client.post("/assist", json={"prompt": "hi"}).json()["assistId"])
    assert body["status"] == "done" and body["backend"] == "claude"
    assert calls == ["codex"]


def test_all_backends_fail(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def bad(prompt: str) -> str:
        raise assist.AssistError("nope")

    monkeypatch.setitem(assist.RUNNERS, "codex", bad)
    monkeypatch.setitem(assist.RUNNERS, "claude", bad)
    body = _wait(client, client.post("/assist", json={"prompt": "hi"}).json()["assistId"])
    assert body["status"] == "error"
    assert "codex: nope" in body["error"] and "claude: nope" in body["error"]


def test_explicit_backend_and_unknown_id(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(assist.RUNNERS, "claude", lambda prompt: "c")
    body = _wait(client, client.post("/assist", json={"prompt": "x", "backend": "claude"}).json()["assistId"])
    assert body["backend"] == "claude"
    assert client.get("/assist/nope").status_code == 404


def test_explicit_backend_goes_first_other_is_backup(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def bad(prompt: str) -> str:
        raise assist.AssistError("down")

    monkeypatch.setitem(assist.RUNNERS, "claude", bad)
    monkeypatch.setitem(assist.RUNNERS, "codex", lambda prompt: "from codex")
    assert assist.backend_order("claude") == ["claude", "codex"]
    body = _wait(client, client.post("/assist", json={"prompt": "x", "backend": "claude"}).json()["assistId"])
    assert body["status"] == "done" and body["backend"] == "codex"


def test_hung_backend_is_failed_over_after_a_failed_probe(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    import threading

    monkeypatch.setattr(assist, "PROBE_AFTER_SECONDS", 0.05)
    monkeypatch.setattr(assist, "_down_until", {})
    release = threading.Event()

    def codex(prompt: str) -> str:
        if prompt == assist.PROBE_PROMPT:
            raise assist.AssistError("timed out after 30s")
        release.wait(5)
        raise assist.AssistError("stopped: the backend stopped responding")

    monkeypatch.setitem(assist.RUNNERS, "codex", codex)
    monkeypatch.setitem(assist.RUNNERS, "claude", lambda prompt: "from claude")
    # the probe marks codex down; in production that aborts the subprocess, here release the stub when it does
    original = assist._probe

    def probe_then_release(name, abort, finished):
        original(name, abort, finished)
        release.set()

    monkeypatch.setattr(assist, "_probe", probe_then_release)
    body = _wait(client, client.post("/assist", json={"prompt": "hi"}).json()["assistId"])
    assert body["status"] == "done" and body["backend"] == "claude"
    assert [a["backend"] for a in body["attempts"]] == ["codex", "claude"]
    assert assist.backend_order("auto")[-1] == "codex"


def test_concurrent_requests_are_capped_by_the_slot_count(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(assist, "_run_slots", threading.BoundedSemaphore(2))
    state = {"now": 0, "peak": 0}
    guard = threading.Lock()

    def slow(prompt: str) -> str:
        with guard:
            state["now"] += 1
            state["peak"] = max(state["peak"], state["now"])
        time.sleep(0.1)
        with guard:
            state["now"] -= 1
        return "ok"

    monkeypatch.setitem(assist.RUNNERS, "codex", slow)
    monkeypatch.setattr(assist, "PROBE_AFTER_SECONDS", 60)
    jobs = [assist.submit("p", "codex") for _ in range(5)]
    deadline = time.time() + 10
    while time.time() < deadline and any(j.status not in ("done", "error") for j in jobs):
        time.sleep(0.02)
    assert [j.status for j in jobs] == ["done"] * 5
    assert state["peak"] == 2
