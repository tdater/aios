-- Skill improvement lifecycle: candidates carry their content and evaluation state; deployed versions keep the exact bytes
-- so rollback is exact and verifiable. Promotion is only ever a human action (see improvements.py).

ALTER TABLE skill_candidates ADD COLUMN content TEXT;
ALTER TABLE skill_candidates ADD COLUMN evals_json TEXT;
ALTER TABLE skill_candidates ADD COLUMN content_sha256 TEXT;
ALTER TABLE skill_candidates ADD COLUMN eval_status TEXT NOT NULL DEFAULT 'not_run'
  CHECK (eval_status IN ('not_run','failed','passed'));
ALTER TABLE skill_candidates ADD COLUMN decision_note TEXT;
ALTER TABLE skill_candidates ADD COLUMN decided_at TEXT;
ALTER TABLE skill_candidates ADD COLUMN proposal_id TEXT;

ALTER TABLE skill_versions ADD COLUMN content TEXT;
ALTER TABLE skill_versions ADD COLUMN sha256 TEXT;
ALTER TABLE skill_versions ADD COLUMN evals_json TEXT;
ALTER TABLE skill_versions ADD COLUMN candidate_id TEXT;
ALTER TABLE skill_versions ADD COLUMN parent_version INTEGER;
ALTER TABLE skill_versions ADD COLUMN deployed_at TEXT;
ALTER TABLE skill_versions ADD COLUMN note TEXT;

CREATE INDEX skill_candidates_name ON skill_candidates(name, status);
