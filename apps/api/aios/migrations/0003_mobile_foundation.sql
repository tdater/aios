-- Mobile-ready foundation: auth sessions, idempotency, record versions, two-phase cancel,
-- block codes, hardened approvals (expiry, superseded status, destructive flag).

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('browser','native')),
  token_hash TEXT NOT NULL UNIQUE,          -- sha256 of the bearer/cookie token; plaintext never stored
  csrf_hash TEXT,                           -- browser sessions only
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoke_reason TEXT
);

CREATE TABLE pairing_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE auth_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL
);

CREATE TABLE idempotency_keys (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER,
  response_json TEXT,                       -- NULL while the first request is in flight
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);

ALTER TABLE runs ADD COLUMN cancel_requested_at TEXT;
ALTER TABLE runs ADD COLUMN cancel_confirmed_at TEXT;
ALTER TABLE runs ADD COLUMN block_code TEXT;
ALTER TABLE runs ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE candidates ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE memories ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE approvals_v2 (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  action_json TEXT NOT NULL,
  action_hash TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','consumed','expired','superseded')),
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  decision_note TEXT,
  consumed_at TEXT,
  expires_at TEXT NOT NULL,
  destructive INTEGER NOT NULL DEFAULT 1,   -- conservative default for unknown actions
  decided_by_session TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO approvals_v2(id,run_id,action_json,action_hash,summary,status,requested_at,decided_at,
                         decision_note,consumed_at,expires_at)
  SELECT id,run_id,action_json,action_hash,summary,
         CASE WHEN status='expired' THEN 'superseded' ELSE status END,
         requested_at,decided_at,decision_note,consumed_at,
         strftime('%Y-%m-%dT%H:%M:%f+00:00', requested_at, '+1 day')
  FROM approvals;
DROP TABLE approvals;
ALTER TABLE approvals_v2 RENAME TO approvals;
CREATE INDEX approvals_status ON approvals(status, requested_at);

-- Versions bump only when a meaningful field changes (not on heartbeats / derived recomputes).
CREATE TRIGGER runs_version AFTER UPDATE OF state, state_reason, cancel_requested_at, cancel_confirmed_at,
  block_code ON runs
  WHEN OLD.state IS NOT NEW.state OR OLD.state_reason IS NOT NEW.state_reason
    OR OLD.cancel_requested_at IS NOT NEW.cancel_requested_at
    OR OLD.cancel_confirmed_at IS NOT NEW.cancel_confirmed_at OR OLD.block_code IS NOT NEW.block_code
BEGIN UPDATE runs SET version = version + 1 WHERE id = NEW.id; END;

CREATE TRIGGER tasks_version AFTER UPDATE OF status, status_reason, title ON tasks
  WHEN OLD.status IS NOT NEW.status OR OLD.status_reason IS NOT NEW.status_reason OR OLD.title IS NOT NEW.title
BEGIN UPDATE tasks SET version = version + 1 WHERE id = NEW.id; END;

CREATE TRIGGER projects_version AFTER UPDATE OF name, status ON projects
  WHEN OLD.name IS NOT NEW.name OR OLD.status IS NOT NEW.status
BEGIN UPDATE projects SET version = version + 1 WHERE id = NEW.id; END;

CREATE TRIGGER approvals_version AFTER UPDATE OF status ON approvals
  WHEN OLD.status IS NOT NEW.status
BEGIN UPDATE approvals SET version = version + 1 WHERE id = NEW.id; END;

CREATE TRIGGER candidates_version AFTER UPDATE OF status, title, problem, scope, validation ON candidates
  WHEN OLD.status IS NOT NEW.status OR OLD.title IS NOT NEW.title OR OLD.problem IS NOT NEW.problem
    OR OLD.scope IS NOT NEW.scope OR OLD.validation IS NOT NEW.validation
BEGIN UPDATE candidates SET version = version + 1 WHERE id = NEW.id; END;

CREATE TRIGGER memories_version AFTER UPDATE OF title, status, confidence, scope, last_reviewed_at ON memories
  WHEN OLD.title IS NOT NEW.title OR OLD.status IS NOT NEW.status OR OLD.confidence IS NOT NEW.confidence
    OR OLD.scope IS NOT NEW.scope OR OLD.last_reviewed_at IS NOT NEW.last_reviewed_at
BEGIN UPDATE memories SET version = version + 1 WHERE id = NEW.id; END;
