-- The Rover (levels 1 and 2 only): one task record per opt-in, and a log of every step. No pictures live here, only their file names.
CREATE TABLE rover_tasks (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level IN (1,2)),
  target TEXT NOT NULL,                -- the one window or app the owner named
  status TEXT NOT NULL CHECK (status IN ('idle','armed','looking','guiding','stopped','finished')),
  stop_reason TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX rover_tasks_status ON rover_tasks(status);
CREATE TABLE rover_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES rover_tasks(id),
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,                  -- look | guide
  outcome TEXT NOT NULL,               -- done | refused | stopped | failed
  summary TEXT NOT NULL,
  picture TEXT,                        -- file name under the Rover picture folder, deleted when the task ends
  instructions_json TEXT,
  ts TEXT NOT NULL
);
CREATE INDEX rover_steps_task ON rover_steps(task_id, seq);
