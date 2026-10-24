"""Generate simple PNG app icons (no dependencies). Run: python scripts/make_icons.py"""
import struct, zlib
from pathlib import Path

out = Path(__file__).resolve().parents[1] / "apps" / "web" / "public"

def png(size, maskable):
    bg, ring, dot = (15, 18, 22), (90, 169, 255), (76, 195, 138)
    pad = 0.18 if maskable else 0.06
    rows = []
    c = (size - 1) / 2
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            d = ((x - c) ** 2 + (y - c) ** 2) ** 0.5 / (size / 2)
            r_out, r_in = 1 - pad - 0.04, 1 - pad - 0.20
            if maskable or True:
                pix = bg
            if r_in <= d <= r_out:
                pix = ring
            elif d < 0.22:
                pix = dot
            row += bytes(pix) + b"\xff"
        rows.append(bytes(row))
    raw = b"".join(rows)
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")

for name, size, mask in (("icon-192.png", 192, False), ("icon-512.png", 512, False), ("icon-maskable-512.png", 512, True)):
    (out / name).write_bytes(png(size, mask))
    print("wrote", name)
