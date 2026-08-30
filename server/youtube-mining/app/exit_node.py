"""Route this box's outbound traffic through a Tailscale exit node for the
duration of a YouTube download.

YouTube bot-blocks datacenter IPs (see app/config.py and the deploy README).
A personal device on a home connection — a laptop or phone already on the
tailnet — advertising a Tailscale exit node gives yt-dlp a residential IP
with no cookie juggling. We flip the box's exit node on just around the
download/subtitle/info fetches and clear it afterwards, so the rest of the
box's traffic (Supabase from the driving scripts, SSH, other services) only
detours for a minute or two per job.

`tailscale set` needs no sudo as long as this service's user is the
Tailscale operator — `sudo tailscale set --operator=<user>`, one-time, by an
admin. If that hasn't been done the `set` calls fail and we log + proceed
direct (the existing silent-stream check then catches a poisoned download).
"""

from __future__ import annotations

import json
import logging
import subprocess
import threading
from collections.abc import Iterator
from contextlib import contextmanager

from app import config

logger = logging.getLogger("youtube_mining_api.exit_node")

# Two concurrent jobs must not both drive `tailscale set` — one would clear
# the node while the other is mid-download. Single-worker uvicorn, so a
# module lock is enough (same reasoning as the job registry).
_lock = threading.Lock()


def _run(args: list[str], timeout: float = 30.0) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            ["tailscale", *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError) as exc:
        logger.warning("`tailscale %s` did not run: %s", " ".join(args), exc)
        return subprocess.CompletedProcess(args, returncode=1, stdout="", stderr=str(exc))


def _online_exit_node_names() -> set[str]:
    """Names (short hostname + first DNS label) of tailnet peers that are
    online *and* advertising an exit node right now."""
    result = _run(["status", "--json"])
    if result.returncode != 0:
        return set()
    try:
        data = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return set()
    names: set[str] = set()
    for peer in (data.get("Peer") or {}).values():
        if not (peer.get("Online") and peer.get("ExitNodeOption")):
            continue
        if host := peer.get("HostName"):
            names.add(host)
        if dns := (peer.get("DNSName") or "").split(".", 1)[0]:
            names.add(dns)
    return names


def _set_exit_node(node: str) -> bool:
    result = _run(["set", f"--exit-node={node}"])
    if result.returncode == 0:
        logger.info("Routing YouTube traffic via Tailscale exit node %s", node)
        return True
    logger.warning(
        "Could not set exit node %s: %s",
        node,
        result.stderr.strip() or result.stdout.strip() or "unknown error",
    )
    return False


def _clear_exit_node() -> None:
    result = _run(["set", "--exit-node="])
    if result.returncode != 0:
        logger.error(
            "Failed to clear Tailscale exit node — the box may still be "
            "routing through it: %s",
            result.stderr.strip() or "unknown error",
        )
    else:
        logger.info("Cleared Tailscale exit node")


@contextmanager
def routed_for_download() -> Iterator[None]:
    """Flip the box onto MINING_EXIT_NODE (or MINING_EXIT_NODE_FALLBACK if
    the primary is offline) for the body, then clear it.

    No-op when MINING_EXIT_NODE is unset (local dev, or a box with a clean
    egress IP). If no configured node is reachable, logs a warning and
    proceeds direct rather than failing the job outright.
    """
    primary = config.MINING_EXIT_NODE
    if not primary:
        yield
        return

    candidates = [primary]
    if config.MINING_EXIT_NODE_FALLBACK:
        candidates.append(config.MINING_EXIT_NODE_FALLBACK)

    with _lock:
        available = _online_exit_node_names()
        active: str | None = None
        for node in candidates:
            if node not in available:
                logger.warning(
                    "Exit node %s is offline or not advertising one — skipping", node
                )
                continue
            if _set_exit_node(node):
                active = node
                break
        if active is None:
            logger.warning(
                "No configured Tailscale exit node is reachable (%s) — "
                "downloading direct. Wake a device or enable its exit node.",
                ", ".join(candidates),
            )
        try:
            yield
        finally:
            if active is not None:
                _clear_exit_node()
