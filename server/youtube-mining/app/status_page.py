"""Server-rendered HTML for GET /status — a no-JS glance at the box's RAM
and disk over the retention window. Pairs with app/metrics.py."""

from __future__ import annotations

import html
from datetime import datetime

GB = 1024 ** 3


def _spark(values: list[float], width: int = 260, height: int = 34) -> str:
    """Inline SVG polyline. Empty / flat series render as a flat mid-line."""
    pts = [v for v in values if v is not None]
    if not pts:
        return f'<svg width="{width}" height="{height}"></svg>'
    lo, hi = min(pts), max(pts)
    span = hi - lo or 1.0
    n = len(values)
    step = width / max(1, n - 1)
    coords = []
    for i, v in enumerate(values):
        if v is None:
            continue
        x = i * step
        y = height - 2 - (v - lo) / span * (height - 4)
        coords.append(f"{x:.1f},{y:.1f}")
    return (
        f'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
        f'preserveAspectRatio="none">'
        f'<polyline fill="none" stroke="currentColor" stroke-width="1.5" '
        f'points="{" ".join(coords)}" /></svg>'
    )


def _bar(used: float, total: float) -> str:
    pct = 0 if not total else min(100, used / total * 100)
    hue = "var(--ok)" if pct < 70 else "var(--warn)" if pct < 88 else "var(--bad)"
    return (
        f'<div class="bar"><div class="fill" style="width:{pct:.1f}%;background:{hue}"></div></div>'
        f'<div class="pct">{pct:.0f}%</div>'
    )


def _row(label: str, latest: str, spark_vals: list[float], sub: str = "") -> str:
    return (
        f'<tr><th>{html.escape(label)}</th>'
        f'<td class="v">{html.escape(latest)}'
        f'{f"<span class=sub>{html.escape(sub)}</span>" if sub else ""}</td>'
        f'<td class="s">{_spark(spark_vals)}</td></tr>'
    )


def render(rows: list[dict]) -> str:
    if not rows:
        body = "<p>No samples yet — the collector timer hasn't run.</p>"
    else:
        latest = rows[-1]
        mem = latest["mem"]
        swap = latest["swap"]
        disk = latest["disk"]

        mem_series = [r["mem"]["used"] / GB for r in rows]
        swap_series = [r["swap"]["used"] / GB for r in rows]
        disk_series = [r["disk"]["used"] / GB for r in rows]

        parts = [
            "<table>",
            f'<tr><th>RAM used</th><td class="v">{mem["used"] / GB:.1f} / {mem["total"] / GB:.1f} GB'
            f'</td><td class="s">{_bar(mem["used"], mem["total"])}</td></tr>',
            _row("RAM trend", f'{mem["used"] / GB:.1f} GB', mem_series,
                 f'{min(mem_series):.1f}–{max(mem_series):.1f} GB over window'),
            _row("Swap used", f'{swap["used"] / GB:.2f} / {swap["total"] / GB:.1f} GB', swap_series),
            f'<tr><th>Disk used</th><td class="v">{disk["used"] / GB:.1f} / {disk["total"] / GB:.1f} GB'
            f'</td><td class="s">{_bar(disk["used"], disk["total"])}</td></tr>',
            _row("Disk trend", f'{disk["used"] / GB:.1f} GB', disk_series,
                 f'{max(disk_series) - min(disk_series):+.2f} GB over window'),
            "</table>",
        ]

        svc_names: list[str] = []
        for r in rows:
            for name in r.get("services", {}):
                if name not in svc_names:
                    svc_names.append(name)
        if svc_names:
            parts.append("<h2>Services (RSS)</h2><table>")
            for name in svc_names:
                series = [
                    (r.get("services", {}).get(name, {}) or {}).get("mem")
                    for r in rows
                ]
                series_gb = [None if m is None else m / GB for m in series]
                cur = latest.get("services", {}).get(name, {}) or {}
                cur_mem = cur.get("mem")
                latest_txt = f'{cur_mem / GB:.2f} GB' if cur_mem else "inactive"
                up = cur.get("uptime_s")
                sub = ""
                if up is not None:
                    sub = f'up {up // 3600}h' if up >= 3600 else f'up {up // 60}m'
                parts.append(_row(name, latest_txt, series_gb, sub))
            parts.append("</table>")

        caches = latest.get("caches", {})
        if caches:
            parts.append("<h2>Caches</h2><table>")
            for name, size in caches.items():
                series = [r.get("caches", {}).get(name, 0) / GB for r in rows]
                parts.append(_row(name.replace("_", " "), f'{size / GB:.2f} GB', series))
            parts.append("</table>")

        span_hrs = 0.0
        try:
            span_hrs = (
                datetime.fromisoformat(rows[-1]["t"]) - datetime.fromisoformat(rows[0]["t"])
            ).total_seconds() / 3600
        except (ValueError, KeyError):
            pass
        parts.append(
            f'<p class="foot">{len(rows)} samples over {span_hrs:.0f} h · '
            f'latest {html.escape(latest["t"])}</p>'
        )
        body = "".join(parts)

    return f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="120">
<title>box status</title>
<style>
  :root {{ color-scheme: light dark; --ok:#3a9d54; --warn:#c98a1b; --bad:#c5443b; }}
  body {{ font: 14px/1.5 system-ui, sans-serif; margin: 1.5rem auto; max-width: 640px; padding: 0 1rem; }}
  h1 {{ font-size: 1.1rem; margin: 0 0 1rem; }}
  h2 {{ font-size: .9rem; text-transform: uppercase; letter-spacing: .04em; opacity: .6; margin: 1.6rem 0 .4rem; }}
  table {{ width: 100%; border-collapse: collapse; }}
  th {{ text-align: left; font-weight: 500; opacity: .8; padding: .35rem .5rem .35rem 0; white-space: nowrap; width: 8.5rem; }}
  td.v {{ font-variant-numeric: tabular-nums; padding: .35rem .5rem; white-space: nowrap; }}
  td.s {{ width: 260px; opacity: .85; }}
  .sub {{ display: block; font-size: .8em; opacity: .55; }}
  .bar {{ display: inline-block; width: 200px; height: 8px; border-radius: 4px; background: color-mix(in srgb, currentColor 15%, transparent); vertical-align: middle; overflow: hidden; }}
  .fill {{ height: 100%; }}
  .pct {{ display: inline-block; margin-left: .5rem; font-variant-numeric: tabular-nums; opacity: .7; }}
  tr {{ border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent); }}
  .foot {{ margin-top: 1.5rem; font-size: .8rem; opacity: .5; }}
</style></head>
<body>
<h1>box status <span style="opacity:.4">· codex-dev</span></h1>
{body}
</body></html>"""
