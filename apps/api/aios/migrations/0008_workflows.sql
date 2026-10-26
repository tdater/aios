-- A workflow is one request carried through implement -> verify -> independent review -> corrections -> result.
-- It owns no model sessions and holds no power of its own: every step is an ordinary run under the same approvals.
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  request TEXT NOT NULL,
  profile TEXT NOT NULL,
  max_rounds INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('working','waiting_you','finished','cancelled')),
  outcome TEXT,                        -- ready | needs_you | no_change | failed | cancelled (set when finished)
  outcome_reason TEXT,
  round INTEGER NOT NULL DEFAULT 0,    -- corrections made so far
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX workflows_conv ON workflows(conversation_id, created_at);

CREATE TABLE workflow_steps (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('implement','review','correct','capture')),
  round INTEGER NOT NULL,
  run_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','done','failed')),
  summary TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (workflow_id, seq)
);
