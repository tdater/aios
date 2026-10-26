"""A read-only look at this PC. It reads a few numbers and explains them; it changes nothing, opens none of your files, and
only reads (never writes) the registry. The numbers are facts; the suggestions are fixed rules over those facts, not a model's opinion."""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

GB = 1024 ** 3
MAX_FILES, MAX_SECONDS = 20000, 3.0


def _memory() -> dict | None:
    if sys.platform == "win32":
        import ctypes

        class MEM(ctypes.Structure):
            _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong), ("total", ctypes.c_ulonglong), ("avail", ctypes.c_ulonglong),
                        ("pt", ctypes.c_ulonglong), ("pa", ctypes.c_ulonglong), ("vt", ctypes.c_ulonglong), ("va", ctypes.c_ulonglong), ("ve", ctypes.c_ulonglong)]
        m = MEM()
        m.length = ctypes.sizeof(MEM)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m)):
            return {"total_bytes": int(m.total), "available_bytes": int(m.avail)}
        return None
    try:
        lines = Path("/proc/meminfo").read_text().splitlines()
        info = {k.strip(): int(v.split()[0]) * 1024 for k, v in (ln.split(":", 1) for ln in lines if ":" in ln)}
        return {"total_bytes": info["MemTotal"], "available_bytes": info["MemAvailable"]}
    except (OSError, KeyError, ValueError):
        return None


def _temp_size() -> dict:
    total, files, start = 0, 0, time.monotonic()
    for root, _dirs, names in os.walk(tempfile.gettempdir(), onerror=lambda e: None):
        for n in names:
            files += 1
            try:
                total += os.lstat(os.path.join(root, n)).st_size
            except OSError:
                pass
            if files >= MAX_FILES or time.monotonic() - start > MAX_SECONDS:
                return {"bytes": total, "files": files, "complete": False}
    return {"bytes": total, "files": files, "complete": True}


def _startup_count() -> int | None:
    if sys.platform != "win32":
        return None
    import winreg
    n = 0
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        try:
            with winreg.OpenKey(hive, r"Software\Microsoft\Windows\CurrentVersion\Run") as k:       # read-only
                n += winreg.QueryInfoKey(k)[1]
        except OSError:
            pass
    return n


def collect() -> dict:
    disk = shutil.disk_usage(Path.home().anchor or "/")
    return {"memory": _memory(), "disk": {"total_bytes": disk.total, "free_bytes": disk.free}, "temp": _temp_size(), "startup_items": _startup_count()}


def suggest(f: dict) -> list[dict]:
    """Plain rules over the facts. Each suggestion carries the number it is based on and says nothing is changed."""
    out = []
    mem, disk, temp, startup = f.get("memory"), f["disk"], f["temp"], f.get("startup_items")
    if mem and mem["total_bytes"]:
        used = 1 - mem["available_bytes"] / mem["total_bytes"]
        if used > 0.85:
            out.append({"id": "memory", "level": "attention", "text": f"Memory is {used:.0%} in use. Closing programs you are not using, or restarting, usually helps most."})
    free_frac = disk["free_bytes"] / disk["total_bytes"] if disk["total_bytes"] else 1
    if free_frac < 0.10 or disk["free_bytes"] < 10 * GB:
        out.append({"id": "disk", "level": "attention", "text": f"Only {disk['free_bytes'] / GB:.1f} GB is free on your main drive ({free_frac:.0%}). Windows slows down when this gets low."})
    if temp["bytes"] > 2 * GB:
        more = "" if temp["complete"] else "at least "
        out.append({"id": "temp", "level": "info", "text": f"Your temporary-files folder holds {more}{temp['bytes'] / GB:.1f} GB. Windows' own Disk Cleanup can clear it safely. AIOS does not delete anything."})
    if startup is not None and startup > 12:
        out.append({"id": "startup", "level": "info", "text": f"{startup} programs start with Windows, which lengthens start-up. Task Manager's Startup tab lets you switch some off."})
    if not out:
        out.append({"id": "ok", "level": "ok", "text": "Nothing stands out. Memory, free disk space and start-up items all look normal."})
    return out
