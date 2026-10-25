"""ntfy notifications: disabled by default, best-effort, and fired on the
terminal states of assistant runs."""

from __future__ import annotations

from typing import Any

import pytest

from app import assist_run, config, notify


class InlineThread:
    def __init__(self, target: Any, args: tuple = (), **kwargs: object) -> None:
        self._target, self._args = target, args

    def start(self) -> None:
        self._target(*self._args)


@pytest.fixture()
def requests_sent(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    sent: list[Any] = []

    class Resp:
        def __enter__(self) -> "Resp":
            return self

        def __exit__(self, *exc: object) -> None:
            return None

    def fake_urlopen(request: Any, timeout: float) -> Resp:
        sent.append(request)
        return Resp()

    monkeypatch.setattr(notify.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(notify.threading, "Thread", InlineThread)
    return sent


def test_disabled_without_url(monkeypatch: pytest.MonkeyPatch, requests_sent: list[Any]) -> None:
    monkeypatch.setattr(config, "NTFY_URL", None)
    notify.notify("t", "m")
    assert requests_sent == []


def test_posts_title_body_and_click(monkeypatch: pytest.MonkeyPatch, requests_sent: list[Any]) -> None:
    monkeypatch.setattr(config, "NTFY_URL", "https://ntfy.example/topic")
    monkeypatch.setattr(config, "NTFY_CLICK_BASE_URL", "https://app.example")
    notify.notify("Quick import ready", "完了", priority="high")
    (req,) = requests_sent
    assert req.full_url == "https://ntfy.example/topic"
    assert req.data == "完了".encode("utf-8")
    assert req.get_header("Title") == "Quick import ready"
    assert req.get_header("Click") == "https://app.example/import/quick"
    assert req.get_header("Priority") == "high"


def test_send_failure_is_swallowed(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(request: Any, timeout: float) -> None:
        raise OSError("down")

    monkeypatch.setattr(notify.urllib.request, "urlopen", boom)
    monkeypatch.setattr(notify.threading, "Thread", InlineThread)
    monkeypatch.setattr(config, "NTFY_URL", "https://ntfy.example/topic")
    notify.notify("t", "m")  # must not raise


@pytest.mark.parametrize(
    ("state", "expected_title"),
    [
        ({"status": "done"}, "Quick import ready"),
        ({"status": "failed", "failure": "boom"}, "Quick import needs attention"),
        ({"status": "interrupted", "failure": None}, "Quick import needs attention"),
        ({"status": "cancelled"}, None),
        ({"status": "running"}, None),
        (None, None),
    ],
)
def test_assist_run_notifies_on_terminal_states(
    monkeypatch: pytest.MonkeyPatch, state: dict | None, expected_title: str | None
) -> None:
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr(assist_run.notify, "notify", lambda title, message, **kw: calls.append((title, message)))
    assist_run._notify_finished(state)
    assert [c[0] for c in calls] == ([expected_title] if expected_title else [])
