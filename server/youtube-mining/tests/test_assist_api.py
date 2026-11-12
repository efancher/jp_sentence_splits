"""POST /assist + GET /assist/{id} — runners are monkeypatched, so this
covers routing, the codex->claude fallback and the no-retry error path."""

from __future__ import annotations

import json
import subprocess
import threading
import time
from pathlib import Path

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
    assert assist.backend_order("claude") == ["claude", "codex", "opencode"]
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


def test_claude_command_pins_model_and_effort(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    seen: list[list[str]] = []

    def fake_run(cmd, prompt, binary, cwd):
        seen.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, "ok", "")

    fake_bin = tmp_path / "claude"
    fake_bin.write_text("")
    monkeypatch.setattr(assist.config, "CLAUDE_PATH", str(fake_bin))
    monkeypatch.setattr(assist.config, "CLAUDE_ASSIST_MODEL", "claude-haiku-5-5")
    monkeypatch.setattr(assist.config, "CLAUDE_ASSIST_EFFORT", "medium")
    monkeypatch.setattr(assist, "_run", fake_run)
    assist.run_claude("hi")
    cmd = seen[0]
    assert cmd[cmd.index("--model") + 1] == "claude-haiku-5-5"
    assert cmd[cmd.index("--effort") + 1] == "medium"

    monkeypatch.setattr(assist.config, "CLAUDE_ASSIST_MODEL", "")
    monkeypatch.setattr(assist.config, "CLAUDE_ASSIST_EFFORT", "")
    assist.run_claude("hi")
    assert "--model" not in seen[1] and "--effort" not in seen[1]


def test_codex_overrides_are_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(assist.config, "CODEX_ASSIST_MODEL", "")
    monkeypatch.setattr(assist.config, "CODEX_ASSIST_EFFORT", "")
    assert assist.codex_args() == []
    monkeypatch.setattr(assist.config, "CODEX_ASSIST_MODEL", "gpt-6-luna")
    monkeypatch.setattr(assist.config, "CODEX_ASSIST_EFFORT", "medium")
    assert assist.codex_args() == ["-m", "gpt-6-luna", "-c", 'model_reasoning_effort="medium"']


def test_opencode_command_denies_tools_and_pins_model(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    seen: list[tuple[list[str], dict]] = []

    def fake_run(cmd, prompt, binary, cwd):
        seen.append((cmd, json.loads((Path(cwd) / "opencode.json").read_text())))
        return subprocess.CompletedProcess(cmd, 0, "ok\n", "> assist")

    fake_bin = tmp_path / "opencode"
    fake_bin.write_text("")
    monkeypatch.setattr(assist.config, "OPENCODE_PATH", str(fake_bin))
    monkeypatch.setattr(assist.config, "OPENCODE_ASSIST_MODEL", "opencode-go/claude-haiku-5-5")
    monkeypatch.setattr(assist.config, "OPENCODE_ASSIST_EFFORT", "")
    monkeypatch.setattr(assist, "_run", fake_run)
    assert assist.run_opencode("hi") == "ok\n"
    cmd, project_config = seen[0]
    assert cmd[1] == "run" and cmd[cmd.index("-m") + 1] == "opencode-go/claude-haiku-5-5"
    assert "--variant" not in cmd
    agent = cmd[cmd.index("--agent") + 1]
    assert project_config["agent"][agent]["permission"] == {"*": "deny"}

    monkeypatch.setattr(assist.config, "OPENCODE_ASSIST_EFFORT", "medium")
    assist.run_opencode("hi")
    assert seen[1][0][seen[1][0].index("--variant") + 1] == "medium"


def test_opencode_is_a_fallback_after_the_requested_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(assist, "_down_until", {})
    assert assist.backend_order("opencode") == ["opencode", "codex", "claude"]
    assert assist.backend_order("claude")[-1] == "opencode"


def test_model_override_applies_to_the_requested_backend_only(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(assist, "_down_until", {})
    seen: dict[str, list[str]] = {}

    def failing_opencode(prompt: str) -> str:
        seen["opencode"] = assist.opencode_args()
        raise assist.AssistError("nope")

    def claude(prompt: str) -> str:
        seen["claude"] = assist.claude_args()
        return "ok"

    monkeypatch.setitem(assist.RUNNERS, "opencode", failing_opencode)
    monkeypatch.setitem(assist.RUNNERS, "claude", claude)
    body = {"prompt": "hi", "backend": "opencode", "model": "opencode-go/glm-5.3", "effort": "high"}
    result = _wait(client, client.post("/assist", json=body).json()["assistId"])
    assert result["status"] == "done" and result["backend"] == "claude"
    assert seen["opencode"][seen["opencode"].index("-m") + 1] == "opencode-go/glm-5.3"
    assert seen["opencode"][seen["opencode"].index("--variant") + 1] == "high"
    assert "opencode-go/glm-5.3" not in seen["claude"]


def test_model_override_rejects_flag_like_values(client: TestClient) -> None:
    for bad in ({"model": "--dangerously-skip-permissions"}, {"effort": "-x"}, {"model": "a b"}):
        assert client.post("/assist", json={"prompt": "hi", **bad}).status_code == 422
