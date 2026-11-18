"""app/exit_node.py — Tailscale exit-node routing around a download."""

from __future__ import annotations

import json
import subprocess

import pytest

from app import config, exit_node

# The autouse fixture stubs this out; the probe's own tests call the original.
_real_wait_for_dns = exit_node._wait_for_dns


def _fake_run(online: dict[str, bool], calls: list[list[str]]):
    """Return a stand-in for `exit_node._run`. `online` maps device name ->
    whether it's an online exit node; `calls` records every invocation."""

    def run(args: list[str], timeout: float = 30.0) -> subprocess.CompletedProcess[str]:
        calls.append(args)
        if args[:2] == ["status", "--json"]:
            peers = {
                f"key{i}": {
                    "HostName": name,
                    "DNSName": f"{name}.tailnet.ts.net.",
                    "Online": is_on,
                    "ExitNodeOption": is_on,
                }
                for i, (name, is_on) in enumerate(online.items())
            }
            return subprocess.CompletedProcess(
                args, 0, stdout=json.dumps({"Peer": peers}), stderr=""
            )
        if args[0] == "set" and args[1].startswith("--exit-node="):
            node = args[1].split("=", 1)[1]
            ok = node == "" or online.get(node, False)
            return subprocess.CompletedProcess(
                args, 0 if ok else 1, stdout="", stderr="" if ok else "not advertising"
            )
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

    return run


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    monkeypatch.setattr(config, "MINING_EXIT_NODE", None)
    monkeypatch.setattr(config, "MINING_EXIT_NODE_FALLBACK", None)
    monkeypatch.setattr(exit_node, "_wait_for_dns", lambda _node: True)


def test_noop_when_unconfigured(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setattr(exit_node, "_run", _fake_run({}, calls))
    with exit_node.routed_for_download():
        pass
    assert calls == []


def test_uses_primary_and_clears(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setattr(config, "MINING_EXIT_NODE", "laptop")
    monkeypatch.setattr(exit_node, "_run", _fake_run({"laptop": True}, calls))
    with exit_node.routed_for_download():
        pass
    assert ["set", "--exit-node=laptop"] in calls
    assert calls[-1] == ["set", "--exit-node="]


def test_falls_back_when_primary_offline(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setattr(config, "MINING_EXIT_NODE", "laptop")
    monkeypatch.setattr(config, "MINING_EXIT_NODE_FALLBACK", "phone")
    monkeypatch.setattr(
        exit_node, "_run", _fake_run({"laptop": False, "phone": True}, calls)
    )
    with exit_node.routed_for_download():
        pass
    assert ["set", "--exit-node=laptop"] not in calls
    assert ["set", "--exit-node=phone"] in calls
    assert calls[-1] == ["set", "--exit-node="]


def test_proceeds_direct_when_none_available(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setattr(config, "MINING_EXIT_NODE", "laptop")
    monkeypatch.setattr(config, "MINING_EXIT_NODE_FALLBACK", "phone")
    monkeypatch.setattr(
        exit_node, "_run", _fake_run({"laptop": False, "phone": False}, calls)
    )
    ran = False
    with exit_node.routed_for_download():
        ran = True
    assert ran
    assert not any(c[:1] == ["set"] for c in calls)


def test_clears_exit_node_on_exception(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setattr(config, "MINING_EXIT_NODE", "laptop")
    monkeypatch.setattr(exit_node, "_run", _fake_run({"laptop": True}, calls))
    with pytest.raises(RuntimeError):
        with exit_node.routed_for_download():
            raise RuntimeError("download blew up")
    assert calls[-1] == ["set", "--exit-node="]


def test_falls_back_when_primary_dns_broken(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setattr(config, "MINING_EXIT_NODE", "phone")
    monkeypatch.setattr(config, "MINING_EXIT_NODE_FALLBACK", "laptop")
    monkeypatch.setattr(
        exit_node, "_run", _fake_run({"phone": True, "laptop": True}, calls)
    )
    monkeypatch.setattr(exit_node, "_wait_for_dns", lambda node: node == "laptop")
    with exit_node.routed_for_download():
        pass
    assert [c for c in calls if c[0] == "set"] == [
        ["set", "--exit-node=phone"],
        ["set", "--exit-node="],
        ["set", "--exit-node=laptop"],
        ["set", "--exit-node="],
    ]


def test_proceeds_direct_when_no_node_resolves_dns(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setattr(config, "MINING_EXIT_NODE", "phone")
    monkeypatch.setattr(exit_node, "_run", _fake_run({"phone": True}, calls))
    monkeypatch.setattr(exit_node, "_wait_for_dns", lambda _node: False)
    ran = False
    with exit_node.routed_for_download():
        ran = True
    assert ran
    # Cleared right after the failed probe, and not a second time on exit.
    assert [c for c in calls if c[0] == "set"] == [
        ["set", "--exit-node=phone"],
        ["set", "--exit-node="],
    ]


def test_wait_for_dns_retries_until_resolvable(monkeypatch):
    results = iter([False, False, True])
    monkeypatch.setattr(exit_node, "_dns_works", lambda: next(results))
    monkeypatch.setattr(exit_node.time, "sleep", lambda _s: None)
    assert _real_wait_for_dns("phone") is True


def test_wait_for_dns_gives_up_after_timeout(monkeypatch):
    clock = iter([0.0, 5.0, 100.0])
    monkeypatch.setattr(exit_node, "_dns_works", lambda: False)
    monkeypatch.setattr(exit_node.time, "monotonic", lambda: next(clock))
    monkeypatch.setattr(exit_node.time, "sleep", lambda _s: None)
    assert _real_wait_for_dns("phone") is False


def test_run_survives_missing_binary(monkeypatch):
    def boom(*_args, **_kwargs):
        raise FileNotFoundError("tailscale")

    monkeypatch.setattr(subprocess, "run", boom)
    result = exit_node._run(["status", "--json"])
    assert result.returncode == 1
