"""POST /assist + GET /assist/{id} — runners are monkeypatched, so this
covers routing, the codex->claude fallback and the no-retry error path."""

from __future__ import annotations

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
    assert body == {"status": "done", "backend": "codex", "reply": "echo:hi", "error": None}


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
