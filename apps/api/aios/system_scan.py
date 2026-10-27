"""A read-only look at this PC. It reads a few numbers and explains them; it changes nothing, opens none of your files, and
only reads (never writes) the registry. The numbers are facts; the suggestions are fixed rules over those facts, not a model's opinion."""
from __future__ import annotations

import csv
import io
import os
import platform
import shutil
import subprocess
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


def _dir_size(path: Path) -> dict:
    """Total size of a folder, counted from file sizes only. File names and contents are never read. Bounded in files and seconds."""
    total, files, start = 0, 0, time.monotonic()
    for root, _dirs, names in os.walk(path, onerror=lambda e: None):
        for n in names:
            files += 1
            try:
                total += os.lstat(os.path.join(root, n)).st_size
            except OSError:
                pass
            if files >= MAX_FILES or time.monotonic() - start > MAX_SECONDS:
                return {"bytes": total, "files": files, "complete": False}
    return {"bytes": total, "files": files, "complete": True}


def _drives() -> list[dict]:
    """Every fixed drive with its size and free space (Windows). Other systems report just the main one through `disk`."""
    if sys.platform != "win32":
        return []
    import ctypes
    out = []
    mask = ctypes.windll.kernel32.GetLogicalDrives()
    for i in range(26):
        if not mask & (1 << i):
            continue
        root = f"{chr(65 + i)}:\\"
        if ctypes.windll.kernel32.GetDriveTypeW(root) != 3:                     # 3 = a fixed disk
            continue
        try:
            u = shutil.disk_usage(root)
        except OSError:
            continue
        out.append({"drive": root[:2], "total_bytes": u.total, "free_bytes": u.free})
    return out


def _uptime_hours() -> float | None:
    if sys.platform != "win32":
        return None
    import ctypes
    k = ctypes.windll.kernel32
    k.GetTickCount64.restype = ctypes.c_ulonglong
    return round(k.GetTickCount64() / 3_600_000, 1)


def _battery() -> dict | None:
    if sys.platform != "win32":
        return None
    import ctypes

    class POWER(ctypes.Structure):
        _fields_ = [("ac", ctypes.c_ubyte), ("flag", ctypes.c_ubyte), ("percent", ctypes.c_ubyte), ("saver", ctypes.c_ubyte), ("life", ctypes.c_ulong), ("full", ctypes.c_ulong)]
    p = POWER()
    if not ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(p)) or p.flag == 128 or p.percent == 255:     # 128 = no battery
        return None
    return {"percent": int(p.percent), "on_ac": p.ac == 1}


def _pending_reboot() -> bool | None:
    if sys.platform != "win32":
        return None
    import winreg
    for path in (r"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired",
                 r"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending"):
        try:
            winreg.CloseKey(winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, path))                         # read-only: it only has to exist
            return True
        except OSError:
            continue
    return False


def _top_memory(n: int = 5) -> list[dict] | None:
    """The programs using the most memory, by name only (no command lines, no window titles). Uses Windows' own tasklist, read-only."""
    if sys.platform != "win32":
        return None
    try:
        out = subprocess.run(["tasklist", "/fo", "csv", "/nh"], capture_output=True, text=True, timeout=8, creationflags=0x08000000).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    totals: dict[str, int] = {}
    for row in csv.reader(io.StringIO(out)):
        if len(row) < 5:
            continue
        try:
            kb = int("".join(ch for ch in row[4] if ch.isdigit()))
        except ValueError:
            continue
        name = row[0][:-4] if row[0].lower().endswith(".exe") else row[0]
        totals[name] = totals.get(name, 0) + kb
    return [{"name": k, "bytes": v * 1024} for k, v in sorted(totals.items(), key=lambda kv: -kv[1])[:n]]


def _startup_names() -> list[str] | None:
    if sys.platform != "win32":
        return None
    import winreg
    names: list[str] = []
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        try:
            with winreg.OpenKey(hive, r"Software\Microsoft\Windows\CurrentVersion\Run") as k:       # read-only: value names, never their commands
                for i in range(winreg.QueryInfoKey(k)[1]):
                    names.append(winreg.EnumValue(k, i)[0][:60])
        except OSError:
            pass
    return names


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
    home = Path.home()
    return {"memory": _memory(), "disk": {"total_bytes": disk.total, "free_bytes": disk.free}, "temp": _temp_size(), "startup_items": _startup_count(),
            "drives": _drives(), "uptime_hours": _uptime_hours(), "battery": _battery(), "pending_reboot": _pending_reboot(),
            "downloads": _dir_size(home / "Downloads") if (home / "Downloads").is_dir() else None,
            "top_memory": _top_memory(), "startup_names": _startup_names(),
            "system": {"os": f"{platform.system()} {platform.release()}", "cpus": os.cpu_count()}}


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
    up = f.get("uptime_hours")
    if f.get("pending_reboot"):
        out.append({"id": "reboot", "level": "attention", "text": "Windows is waiting for a restart to finish installing updates. Restarting soon keeps it secure and running smoothly."})
    elif up is not None and up > 24 * 7:
        out.append({"id": "uptime", "level": "info", "text": f"This computer has been on for {up / 24:.0f} days without a restart. A restart clears out slowdowns that build up."})
    bat = f.get("battery")
    if bat and bat["percent"] < 20 and not bat["on_ac"]:
        out.append({"id": "battery", "level": "attention", "text": f"The battery is at {bat['percent']}% and the charger is not connected."})
    dl = f.get("downloads")
    if dl and dl["bytes"] > 5 * GB:
        more = "" if dl["complete"] else "at least "
        out.append({"id": "downloads", "level": "info", "text": f"Your Downloads folder holds {more}{dl['bytes'] / GB:.1f} GB. Old installers and files you no longer need are often in there. AIOS does not look inside or delete anything."})
    main = (Path.home().anchor or "")[:2]
    for d in f.get("drives") or []:
        if d["total_bytes"] and d["drive"] != main and d["free_bytes"] / d["total_bytes"] < 0.10:
            out.append({"id": "drive2", "level": "attention", "text": f"Drive {d['drive']} has only {d['free_bytes'] / GB:.1f} GB free ({d['free_bytes'] / d['total_bytes']:.0%})."})
    top = f.get("top_memory") or []
    if top and mem and mem["total_bytes"] and top[0]["bytes"] > 1.5 * GB and top[0]["bytes"] / mem["total_bytes"] > 0.2:
        out.append({"id": "topmem", "level": "info", "text": f"{top[0]['name']} is using {top[0]['bytes'] / GB:.1f} GB of memory, the most of anything running. Saving your work and reopening it often frees a lot."})
    if not out:
        out.append({"id": "ok", "level": "ok", "text": "Nothing stands out. Memory, free disk space and start-up items all look normal."})
    return out
