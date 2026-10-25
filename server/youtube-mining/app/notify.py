"""Optional phone notifications via ntfy (https://ntfy.sh or self-hosted).

Set `MINING_NTFY_URL` to the full topic URL (e.g. `https://ntfy.sh/<secret-topic>`)
to enable; unset means every call is a no-op. Sending is best-effort — a
notification failure must never affect a job or assistant run.
"""

from __future__ import annotations

import logging
import threading
import urllib.request

from app import config

logger = logging.getLogger("youtube_mining_api.notify")

TIMEOUT_SECONDS = 10


def _post(url: str, title: str, message: str, click: str | None, priority: str) -> None:
    # HTTP headers are latin-1; ntfy accepts RFC 2047 but ASCII titles are all we send.
    headers = {"Title": title, "Priority": priority}
    if click:
        headers["Click"] = click
    request = urllib.request.Request(url, data=message.encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS):
            pass
    except Exception:  # noqa: BLE001 - best-effort
        logger.warning("ntfy notification failed", exc_info=True)


def notify(title: str, message: str, *, path: str = "/import/quick", priority: str = "default") -> None:
    """Fire-and-forget; returns immediately. `path` is appended to the app base URL."""
    url = config.NTFY_URL
    if not url:
        return
    click = f"{config.NTFY_CLICK_BASE_URL}{path}" if config.NTFY_CLICK_BASE_URL else None
    threading.Thread(target=_post, args=(url, title, message, click, priority), daemon=True).start()
