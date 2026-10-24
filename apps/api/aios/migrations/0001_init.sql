-- AIOS operational database, migration 0001.
-- Ownership: SQLite owns tasks, runs, approvals, schedules, metrics, indexes.
-- Markdown vault owns durable knowledge text; memory rows here are an index
-- (rebuildable from the vault) plus review metadata.

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A workspace is an explicitly registered root. Nothing outside registered
-- roots is ever read by an executor.
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  path TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'generic',
  registered_at TEXT NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  workspace_id TEXT REFERENCES workspaces(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  spec_json TEXT NOT NULL DEFAULT '{}',
  acceptance_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','blocked','done','failed','cancelled')),
  status_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE task_deps (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  depends_on TEXT NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, depends_on),
  CHECK (task_id <> depends_on)
);

CREATE TABLE workflow_defs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE workflow_versions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow_defs(id),
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','active','retired','rolled_back')),
  created_at TEXT NOT NULL,
  UNIQUE (workflow_id, version)
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  workflow_version_id TEXT REFERENCES workflow_versions(id),
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','running','awaiting_approval','blocked',
                     'interrupted','succeeded','failed','cancelled')),
  state_reason TEXT,
  idempotency_key TEXT UNIQUE,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  iteration INTEGER NOT NULL DEFAULT 0,
  max_iterations INTEGER NOT NULL DEFAULT 1000,
  deadline_s INTEGER NOT NULL DEFAULT 300,
  deadline_at TEXT,
  last_error_fingerprint TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX runs_state ON runs(state);
CREATE INDEX runs_task ON runs(task_id);

CREATE TABLE run_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  n INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT,
  error_fingerprint TEXT,
  error TEXT,
  retryable INTEGER NOT NULL DEFAULT 0
);

-- side_effect=1 steps touch the outside world. A step left in 'started' after
-- a crash is NEVER replayed automatically (see engine.reconcile).
CREATE TABLE steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  seq INTEGER NOT NULL,
  name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('started','done','failed','uncertain')),
  side_effect INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  output_json TEXT,
  error TEXT,
  UNIQUE (run_id, name)
);

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  name TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  data_json TEXT
);
CREATE INDEX run_events_run ON run_events(run_id, id);

-- path is relative to <state>/artifacts; bytes are integrity-checked by sha256.
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  provenance TEXT NOT NULL DEFAULT 'generated',
  created_at TEXT NOT NULL
);

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  step_id TEXT REFERENCES steps(id),
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  ref TEXT,
  created_at TEXT NOT NULL
);

-- Approval binds to the sha256 of the canonical action JSON. Changing the
-- action changes the hash, which invalidates the approval. Single use.
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  action_json TEXT NOT NULL,
  action_hash TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','consumed','expired')),
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  decision_note TEXT,
  consumed_at TEXT
);

CREATE TABLE workspace_locks (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  acquired_at TEXT NOT NULL
);

-- Memory index. Body text lives in the markdown vault file at vault_path.
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('global','project')),
  project_id TEXT REFERENCES projects(id),
  type TEXT NOT NULL CHECK (type IN ('preference','fact','decision','lesson','procedure')),
  basis TEXT NOT NULL DEFAULT 'observation' CHECK (basis IN ('observation','inference')),
  title TEXT NOT NULL,
  vault_path TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','approved','superseded','rejected')),
  sensitivity TEXT NOT NULL DEFAULT 'private'
    CHECK (sensitivity IN ('public','private','secret-adjacent')),
  superseded_by TEXT REFERENCES memories(id),
  created_at TEXT NOT NULL,
  last_reviewed_at TEXT
);

CREATE TABLE memory_evidence (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id),
  run_id TEXT REFERENCES runs(id),
  artifact_id TEXT REFERENCES artifacts(id),
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE skill_candidates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rationale TEXT NOT NULL,
  definition_path TEXT,
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','evaluating','rejected','approved')),
  created_at TEXT NOT NULL
);

CREATE TABLE skill_versions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  git_ref TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','rolled_back','retired')),
  created_at TEXT NOT NULL,
  UNIQUE (name, version)
);

CREATE TABLE eval_cases (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  description TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE eval_results (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES eval_cases(id),
  subject TEXT NOT NULL,
  passed INTEGER NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE provider_caps (
  provider TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('interactive','manual_handoff','automated','unavailable')),
  billing TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  checked_at TEXT NOT NULL
);

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  interval_s INTEGER NOT NULL,
  max_runs INTEGER NOT NULL,
  runs_done INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 0,
  next_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE improvement_proposals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  risk TEXT NOT NULL CHECK (risk IN ('low','medium','high')),
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','evaluated','approved','rejected','deployed','rolled_back')),
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail_json TEXT
);
