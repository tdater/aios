-- Conversations: a persisted, attributed exchange between the owner, a provider, and AIOS about one
-- project. Provider edits happen in an isolated git worktree (one per conversation), never in the
-- registered project folder.

-- Verification command for a project, an argv list set explicitly by the owner (JSON array of
-- strings). NULL means no automatic verification. Never filled in by a provider or by AIOS itself.
ALTER TABLE projects ADD COLUMN verify_json TEXT;

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  title TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'claude' CHECK (provider IN ('claude')),
  model TEXT,                       -- NULL = the account default model
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','archived')),
  session_id TEXT,                  -- the provider own session id, used to resume the conversation
  worktree_path TEXT,
  branch TEXT,
  base_revision TEXT,               -- revision the worktree was created from
  head_revision TEXT,               -- latest commit AIOS recorded on the branch
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX conversations_project ON conversations(project_id, created_at);

CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  -- who actually produced the text: the owner, the provider's model, or AIOS itself
  author_kind TEXT NOT NULL CHECK (author_kind IN ('user','provider','aios')),
  author TEXT NOT NULL,             -- e.g. 'you', 'claude-code 2.1.310 (claude-opus-5-5)', 'aios'
  kind TEXT NOT NULL DEFAULT 'message' CHECK (kind IN ('message','status','patch','verification','review')),
  content TEXT NOT NULL,
  run_id TEXT REFERENCES runs(id),
  meta_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (conversation_id, seq)
);
CREATE INDEX conversation_messages_run ON conversation_messages(run_id);

-- Exactly which context AIOS handed the provider for a turn, with the version of each item, so a
-- result can always be traced back to what the provider was told.
CREATE TABLE context_supplied (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  item_kind TEXT NOT NULL,          -- memory | project | repository | verification | rules
  item_ref TEXT NOT NULL,           -- memory id, revision, etc.
  item_version TEXT,                -- memory version, commit sha, ...
  item_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX context_supplied_run ON context_supplied(run_id);

CREATE TRIGGER conversations_version AFTER UPDATE OF title, status, head_revision, session_id ON conversations
  WHEN OLD.title IS NOT NEW.title OR OLD.status IS NOT NEW.status
    OR OLD.head_revision IS NOT NEW.head_revision OR OLD.session_id IS NOT NEW.session_id
BEGIN UPDATE conversations SET version = version + 1 WHERE id = NEW.id; END;
