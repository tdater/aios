from aios import providers


def test_retired_gemini_row_is_removed_on_discovery(db):
    db.execute("INSERT INTO provider_caps(provider,mode,billing,detail_json,checked_at) "
               "VALUES ('gemini','manual_handoff','unknown','{}','2026-01-01T00:00:00+00:00')")
    names = {c["provider"] for c in providers.discover(db)}
    assert "gemini" not in names
    assert {"claude", "antigravity", "perplexity", "mock"} <= names


def test_antigravity_is_never_started_by_aios(db, monkeypatch):
    started = []
    monkeypatch.setattr(providers.shutil, "which", lambda n: "/usr/bin/agy" if n == "agy" else None)
    monkeypatch.setattr(providers, "_run", lambda cmd, timeout=20: started.append(cmd) or (0, "agy 1.2.3"))
    providers.discover(db)
    cap = providers.capability(db, "antigravity")
    assert cap["mode"] == "manual_handoff" and cap["detail"]["found"] is True
    assert "suspension" in cap["detail"]["note"]
    assert not any("agy" in str(cmd[0]) for cmd in started), "AIOS must not run agy, even for --version"
