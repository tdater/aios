"""Draws assets/aios.ico (a proof-seal style badge) with no third-party libraries. Run once: python scripts/make_icon.py"""
import math
import struct
import zlib
from pathlib import Path

SIZES = (16, 32, 48, 64, 128, 256)
TOP, BOTTOM = (0x7B, 0x6C, 0xF6), (0x45, 0x37, 0xC2)


def pixel(x: float, y: float, s: int) -> tuple[float, float, float, float]:
    """RGBA (0-1 alpha) at a point in the unit square, for an icon of size s."""
    u, v = x / s, y / s
    r = 0.22                                            # rounded-square corner radius
    dx, dy = max(abs(u - 0.5) - (0.5 - r), 0), max(abs(v - 0.5) - (0.5 - r), 0)
    if math.hypot(dx, dy) > r:
        return 0, 0, 0, 0
    t = v
    col = [TOP[i] + (BOTTOM[i] - TOP[i]) * t for i in range(3)]
    d = math.hypot(u - 0.5, v - 0.5)
    for radius, width, alpha in ((0.36, 0.05, 0.95), (0.25, 0.05, 0.85)):
        if abs(d - radius) < width / 2:
            col, a = [255, 255, 255], alpha
            return col[0], col[1], col[2], a
    if d < 0.11:
        return 255, 255, 255, 1
    return col[0], col[1], col[2], 1


def render(s: int) -> bytes:
    ss = 3                                              # 3x3 supersampling for smooth edges
    raw = bytearray()
    for py in range(s):
        raw.append(0)                                   # PNG filter: none
        for px in range(s):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(ss):
                for sx in range(ss):
                    r, g, b, a = pixel(px + (sx + 0.5) / ss, py + (sy + 0.5) / ss, s)
                    acc[0] += r * a; acc[1] += g * a; acc[2] += b * a; acc[3] += a
            n = ss * ss
            a = acc[3] / n
            raw += bytes(int(round(acc[i] / acc[3])) if acc[3] else 0 for i in range(3)) + bytes([int(round(a * 255))])

    def chunk(tag: bytes, data: bytes) -> bytes:
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", s, s, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def main() -> None:
    images = [render(s) for s in SIZES]
    out = bytearray(struct.pack("<HHH", 0, 1, len(images)))
    offset = 6 + 16 * len(images)
    for s, png in zip(SIZES, images):
        out += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(png), offset)
        offset += len(png)
    for png in images:
        out += png
    dest = Path(__file__).resolve().parents[1] / "assets" / "aios.ico"
    dest.parent.mkdir(exist_ok=True)
    dest.write_bytes(bytes(out))
    print(f"wrote {dest} ({len(out)} bytes)")


if __name__ == "__main__":
    main()
