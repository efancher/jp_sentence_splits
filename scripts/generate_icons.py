"""Generate dependency-free PNG icons for Satori Glossbook."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "public" / "icons"

TEAL = (15, 107, 92, 255)
DEEP_TEAL = (8, 73, 64, 255)
CREAM = (244, 255, 251, 255)
AMBER = (230, 192, 123, 255)


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def _inside_polygon(x: float, y: float, points: list[tuple[float, float]]) -> bool:
    inside = False
    previous = points[-1]
    for current in points:
        x1, y1 = previous
        x2, y2 = current
        if (y1 > y) != (y2 > y):
            crossing = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x < crossing:
                inside = not inside
        previous = current
    return inside


def _render(size: int) -> bytes:
    pixels = [[TEAL for _ in range(size)] for _ in range(size)]

    def fill_circle(cx: float, cy: float, radius: float, color: tuple[int, ...]) -> None:
        radius_squared = radius * radius
        for y in range(size):
            for x in range(size):
                if (x - cx) ** 2 + (y - cy) ** 2 <= radius_squared:
                    pixels[y][x] = color

    def fill_polygon(
        normalized_points: list[tuple[float, float]], color: tuple[int, ...]
    ) -> None:
        points = [(x * size, y * size) for x, y in normalized_points]
        for y in range(size):
            for x in range(size):
                if _inside_polygon(x + 0.5, y + 0.5, points):
                    pixels[y][x] = color

    fill_circle(size * 0.5, size * 0.5, size * 0.39, DEEP_TEAL)
    fill_polygon(
        [(0.18, 0.29), (0.47, 0.36), (0.47, 0.76), (0.18, 0.68)], CREAM
    )
    fill_polygon(
        [(0.53, 0.36), (0.82, 0.29), (0.82, 0.68), (0.53, 0.76)], CREAM
    )
    fill_polygon(
        [(0.47, 0.36), (0.5, 0.4), (0.53, 0.36), (0.53, 0.76), (0.5, 0.79), (0.47, 0.76)],
        AMBER,
    )

    raw = b"".join(
        b"\x00" + b"".join(bytes(pixel) for pixel in row) for row in pixels
    )
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"".join(
        (
            b"\x89PNG\r\n\x1a\n",
            _png_chunk(b"IHDR", header),
            _png_chunk(b"IDAT", zlib.compress(raw, 9)),
            _png_chunk(b"IEND", b""),
        )
    )


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    for filename, size in (
        ("icon-192.png", 192),
        ("icon-512.png", 512),
        ("apple-touch-icon.png", 180),
    ):
        (ICON_DIR / filename).write_bytes(_render(size))


if __name__ == "__main__":
    main()
