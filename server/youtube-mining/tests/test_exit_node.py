"""app/exit_node.py — Tailscale exit-node routing around a download."""

from __future__ import annotations

import json
import subprocess

import pytest

from app import config, exit_node


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


def test_run_survives_missing_binary(monkeypatch):
    def boom(*_args, **_kwargs):
        raise FileNotFoundError("tailscale")

    monkeypatch.setattr(subprocess, "run", boom)
    result = exit_node._run(["status", "--json"])
    assert result.returncode == 1
