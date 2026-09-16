#!/usr/bin/env python3
"""Génère les icônes PNG de l'extension (aucune dépendance externe).

Usage : python3 tools/make_icons.py
"""
import struct
import zlib
from pathlib import Path

SIZES = (16, 32, 48, 128)
SS = 4  # suréchantillonnage

BG_TOP = (0x5B, 0x49, 0xE0)
BG_BOTTOM = (0x35, 0x27, 0xA8)
ARROW = (0xFF, 0xFF, 0xFF)


def rounded_rect(x, y, w, h, r):
    """True si (x, y) est dans le rectangle arrondi [0, w] x [0, h]."""
    cx = min(max(x, r), w - r)
    cy = min(max(y, r), h - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def in_triangle(px, py, a, b, c):
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])

    d1 = sign((px, py), a, b)
    d2 = sign((px, py), b, c)
    d3 = sign((px, py), c, a)
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def arrow_alpha(u, v):
    """Flèche « → » dans un repère normalisé [0, 1]."""
    shaft = 0.16 <= u <= 0.60 and 0.445 <= v <= 0.555
    head = in_triangle(u, v, (0.54, 0.28), (0.86, 0.5), (0.54, 0.72))
    return shaft or head


def render(size):
    dim = size * SS
    radius = dim * 0.22
    rows = []
    for py in range(dim):
        row = bytearray()
        for px in range(dim):
            x, y = px + 0.5, py + 0.5
            if not rounded_rect(x, y, dim, dim, radius):
                row += bytes((0, 0, 0, 0))
                continue
            t = y / dim
            bg = tuple(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
            if arrow_alpha(x / dim, y / dim):
                row += bytes((*ARROW, 255))
            else:
                row += bytes((*bg, 255))
        rows.append(bytes(row))
    return downsample(rows, dim, size)


def downsample(rows, dim, size):
    out = []
    for oy in range(size):
        line = bytearray()
        for ox in range(size):
            r = g = b = a = 0
            for dy in range(SS):
                row = rows[oy * SS + dy]
                for dx in range(SS):
                    i = (ox * SS + dx) * 4
                    pa = row[i + 3]
                    r += row[i] * pa
                    g += row[i + 1] * pa
                    b += row[i + 2] * pa
                    a += pa
            n = SS * SS
            if a == 0:
                line += bytes((0, 0, 0, 0))
            else:
                line += bytes((round(r / a), round(g / a), round(b / a), round(a / n)))
        out.append(bytes(line))
    return out


def write_png(path, rows, size):
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    out_dir = Path(__file__).resolve().parent.parent / "icons"
    out_dir.mkdir(exist_ok=True)
    for size in SIZES:
        target = out_dir / f"icon{size}.png"
        write_png(target, render(size), size)
        print(f"{target.relative_to(out_dir.parent)} ({target.stat().st_size} octets)")


if __name__ == "__main__":
    main()
