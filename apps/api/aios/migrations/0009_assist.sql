-- A task started from the dashboard's single prompt: what was asked, the plan AIOS chose (frozen, so the owner can see what it
-- decided), and the conversation (and, for builds, the workflow) that does the work.
CREATE TABLE assists (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  workflow_id TEXT REFERENCES workflows(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,
  chosen_by_owner INTEGER NOT NULL DEFAULT 0,
  prompt TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX assists_created ON assists(created_at);
