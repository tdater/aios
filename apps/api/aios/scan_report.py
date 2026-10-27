"""What the computer check found, said for people: plain rows, and ideas for what to do next.

Everything here is a fixed rule over the facts that system_scan.collect() read. There is no model in this file and nothing is changed
on the computer: an idea is a suggestion, and the ones that carry an `ask` only prepare a request the owner can choose to send."""
from __future__ import annotations

from pathlib import Path

GB = 1024 ** 3


def _gb(n: float) -> str:
    return f"{n / GB:.1f} GB"


def summarize(f: dict) -> list[dict]:
    """The facts as plain rows: {label, value, tone}. The screen shows these, so nothing is ever shown as a raw object."""
    rows: list[dict] = []
    mem = f.get("memory")
    if mem and mem.get("total_bytes"):
        used = 1 - mem["available_bytes"] / mem["total_bytes"]
        rows.append({"label": "Memory", "value": f"{_gb(mem['total_bytes'] - mem['available_bytes'])} of {_gb(mem['total_bytes'])} in use ({used:.0%})", "tone": "warn" if used > 0.85 else "ok"})
    d = f.get("disk")
    if d and d.get("total_bytes"):
        frac = d["free_bytes"] / d["total_bytes"]
        rows.append({"label": "Main drive", "value": f"{_gb(d['free_bytes'])} free of {_gb(d['total_bytes'])} ({frac:.0%} free)", "tone": "warn" if frac < 0.10 or d["free_bytes"] < 10 * GB else "ok"})
    main = (Path.home().anchor or "")[:2]
    for x in f.get("drives") or []:
        if x["drive"] != main and x["total_bytes"]:
            frac = x["free_bytes"] / x["total_bytes"]
            rows.append({"label": f"Drive {x['drive']}", "value": f"{_gb(x['free_bytes'])} free of {_gb(x['total_bytes'])} ({frac:.0%} free)", "tone": "warn" if frac < 0.10 else "ok"})
    t = f.get("temp")
    if t:
        rows.append({"label": "Temporary files", "value": f"{'at least ' if not t.get('complete', True) else ''}{_gb(t['bytes'])} in {t['files']:,} files", "tone": "warn" if t["bytes"] > 2 * GB else "ok"})
    dl = f.get("downloads")
    if dl:
        rows.append({"label": "Downloads folder", "value": f"{'at least ' if not dl['complete'] else ''}{_gb(dl['bytes'])}", "tone": "warn" if dl["bytes"] > 5 * GB else "ok"})
    n = f.get("startup_items")
    if n is not None:
        names = f.get("startup_names") or []
        shown = f": {', '.join(names[:8])}{'…' if len(names) > 8 else ''}" if names else ""
        rows.append({"label": "Programs that start with Windows", "value": f"{n}{shown}", "tone": "warn" if n > 12 else "ok"})
    if f.get("uptime_hours") is not None:
        h = f["uptime_hours"]
        rows.append({"label": "On since last restart", "value": f"{h / 24:.1f} days" if h >= 48 else f"{h:.0f} hours", "tone": "warn" if h > 24 * 7 else "ok"})
    if f.get("pending_reboot") is not None:
        rows.append({"label": "Waiting for a restart", "value": "Yes" if f["pending_reboot"] else "No", "tone": "warn" if f["pending_reboot"] else "ok"})
    b = f.get("battery")
    if b:
        rows.append({"label": "Battery", "value": f"{b['percent']}%, {'plugged in' if b['on_ac'] else 'on battery'}", "tone": "warn" if b["percent"] < 20 and not b["on_ac"] else "ok"})
    top = f.get("top_memory")
    if top:
        rows.append({"label": "Using the most memory", "value": ", ".join(f"{x['name']} ({_gb(x['bytes'])})" for x in top[:5]), "tone": "ok"})
    sysi = f.get("system")
    if sysi:
        rows.append({"label": "This computer", "value": f"{sysi.get('os', '')}, {sysi.get('cpus')} processor threads", "tone": "ok"})
    return rows


def ideas(f: dict, *, weekly_checkup_on: bool = False) -> list[dict]:
    """What AIOS can help with next. {id, title, why} and sometimes `ask`: a request the owner can send to AIOS with one click."""
    out: list[dict] = []
    if not weekly_checkup_on:
        out.append({"id": "weekly", "title": "Turn on the weekly check-up", "why": "AIOS reads these same numbers once a week and tells you only when something needs attention."})
    names = f.get("startup_names") or []
    if (f.get("startup_items") or 0) > 8 and names:
        out.append({"id": "startup_help", "title": "Ask which start-up programs you can switch off",
                    "why": f"{len(names)} programs start with Windows. AIOS can explain what each one usually is.",
                    "ask": "These programs start with my Windows computer: " + ", ".join(names[:25]) + ". In plain words, which ones are usually safe to switch off to speed up start-up, "
                           "and which should I leave alone? Do not guess about ones you do not recognise: say so."})
    top = f.get("top_memory") or []
    mem = f.get("memory")
    if top and mem and mem.get("total_bytes") and 1 - mem["available_bytes"] / mem["total_bytes"] > 0.8:
        out.append({"id": "memory_help", "title": "Ask what is using your memory", "why": "Memory is mostly in use. AIOS can explain the biggest programs and what is safe to close.",
                    "ask": "My computer's memory is nearly full. The programs using the most are: " + ", ".join(f"{x['name']} ({x['bytes'] / GB:.1f} GB)" for x in top[:5])
                           + ". In plain words, what are these, and which can I safely close or restart first?"})
    dl = f.get("downloads")
    if dl and dl["bytes"] > 5 * GB:
        out.append({"id": "downloads_help", "title": "Plan a Downloads clean-up", "why": "A big Downloads folder is the easiest space to win back, and what goes is your decision.",
                    "ask": f"My Downloads folder is {_gb(dl['bytes'])}. Give me a short, safe routine for cleaning it out by hand: what kinds of files to look for first, "
                           "how to sort by size in File Explorer, and what to check before deleting."})
    if f.get("pending_reboot") or (f.get("uptime_hours") or 0) > 24 * 7:
        out.append({"id": "restart", "title": "Restart when you are ready", "why": "Save your work first. A restart finishes updates and clears slowdowns."})
    if not any(r["tone"] == "warn" for r in summarize(f)):
        out.append({"id": "backup", "title": "Make a backup of AIOS", "why": "Everything looks healthy, so this is a good moment. The Home Base port makes a backup in one click."})
    return out
