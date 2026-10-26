-- Opt-in abilities, a global pause, and receipts (a plain-language record of what AIOS did).
-- Every ability is OFF until the owner turns it on; enabling needs an explicit confirmation recorded here.
CREATE TABLE abilities (
  name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,                 -- owner | aios | ability name
  kind TEXT NOT NULL,                  -- e.g. ability.enabled, system_scan.run, widget.created, pause
  summary TEXT NOT NULL,               -- one plain sentence
  changed INTEGER NOT NULL DEFAULT 0   -- 1 when this action changed something on the computer or in AIOS
);
CREATE INDEX receipts_ts ON receipts(ts);

-- Widgets are data, not code: a kind from a closed list plus validated plain-text settings.
CREATE TABLE widgets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('counter','checklist','note')),
  title TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
