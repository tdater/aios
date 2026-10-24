-- History bootstrap + memory layer. Raw history never enters Git; text stored here is REDACTED.

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  rel_path TEXT NOT NULL,                 -- relative to <state>/imports/approved
  kind TEXT NOT NULL,                     -- detected format, or 'unsupported'
  provider TEXT,
  project_id TEXT REFERENCES projects(id),
  content_hash TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime_ns INTEGER NOT NULL,
  date_start TEXT,
  date_end TEXT,
  imported_at TEXT NOT NULL,
  parser TEXT,
  parser_version INTEGER,
  status TEXT NOT NULL CHECK (status IN
    ('parsed','unsupported','failed','quarantined','duplicate','deleted')),
  status_detail TEXT,
  dup_of TEXT REFERENCES sources(id),
  message_count INTEGER NOT NULL DEFAULT 0,
  sensitivity TEXT NOT NULL DEFAULT 'private'
    CHECK (sensitivity IN ('public','private','secret-adjacent')),
  secret_kinds_json TEXT NOT NULL DEFAULT '[]',
  coverage_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (rel_path, content_hash)
);
CREATE INDEX sources_hash ON sources(content_hash);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES sources(id),
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts TEXT,
  role TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN
    ('user_statement','user_confirmation','assistant_suggestion','tool_output',
     'executed_command','test_result','document','system_injected')),
  text TEXT NOT NULL,                     -- redacted
  ref TEXT NOT NULL,                      -- original location, e.g. file.jsonl:L12
  fingerprint TEXT NOT NULL,
  canon_id INTEGER,                       -- first message with this fingerprint (self if first)
  injection_suspect INTEGER NOT NULL DEFAULT 0,
  test_outcome TEXT CHECK (test_outcome IN ('pass','fail') OR test_outcome IS NULL)
);
CREATE INDEX messages_source ON messages(source_id, session_id, seq);
CREATE INDEX messages_fp ON messages(fingerprint);
CREATE VIRTUAL TABLE messages_fts USING fts5(text);

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('preference','project_fact','decision','skill','script',
    'workflow','lesson','verification_gate','guardrail','backlog','unresolved_question')),
  title TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global','project')),
  project_id TEXT REFERENCES projects(id),
  problem TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT '',
  validation TEXT NOT NULL DEFAULT 'not_verifiable' CHECK (validation IN
    ('historically_reported','preserved_test_evidence','revalidated_current','not_verifiable')),
  confidence REAL NOT NULL DEFAULT 0.3,
  uncertainty TEXT NOT NULL DEFAULT '',
  prerequisites TEXT NOT NULL DEFAULT '',
  benefit TEXT NOT NULL DEFAULT 'unknown',
  benefit_basis TEXT NOT NULL DEFAULT 'unknown' CHECK (benefit_basis IN ('measured','estimated','unknown')),
  risk TEXT NOT NULL DEFAULT 'low' CHECK (risk IN ('low','medium','high')),
  maintenance TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL DEFAULT '',
  key_json TEXT NOT NULL DEFAULT '[]',     -- normalised key tokens used to match recurrences
  polarity TEXT,                           -- 'do' | 'dont' for preference-like candidates
  corrections INTEGER NOT NULL DEFAULT 0,  -- user corrections among the support
  distinct_occurrences INTEGER NOT NULL DEFAULT 0,
  distinct_sources INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  flags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN
    ('candidate','approved','rejected','deferred','merged','superseded','orphaned')),
  active INTEGER NOT NULL DEFAULT 0,      -- nothing derived from history is ever auto-activated
  reviewer_note TEXT,
  decided_at TEXT,
  evidence_at_decision INTEGER,
  merged_into TEXT REFERENCES candidates(id),
  superseded_by TEXT REFERENCES candidates(id),
  memory_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX candidates_status ON candidates(status, score);

CREATE TABLE candidate_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  message_id INTEGER NOT NULL REFERENCES messages(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  role TEXT NOT NULL CHECK (role IN ('support','counter')),
  excerpt TEXT NOT NULL,
  UNIQUE (candidate_id, message_id, role)
);

CREATE TABLE candidate_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  action TEXT NOT NULL,
  note TEXT,
  before_json TEXT,
  ts TEXT NOT NULL
);

CREATE TABLE review_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','no_change','limit_reached')),
  report_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE VIRTUAL TABLE memories_fts USING fts5(title, body);
ALTER TABLE memories ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
