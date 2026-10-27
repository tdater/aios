-- One more kind of small panel: mission (a life goal with a target date and steps). SQLite cannot widen a
-- CHECK in place, so the table is rebuilt with its rows kept.
CREATE TABLE widgets_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('counter','checklist','note','habit','timer','routine','facts','mission')),
  title TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO widgets_new(id,kind,title,config_json,created_at,updated_at) SELECT id,kind,title,config_json,created_at,updated_at FROM widgets;
DROP TABLE widgets;
ALTER TABLE widgets_new RENAME TO widgets;
