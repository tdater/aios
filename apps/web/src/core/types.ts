// Hand-written to match docs/openapi-v1.json (the contract test fails if the API surface drifts).
export const API_VERSION = 1;
export const APP_NAME = "aios-web";
export const APP_VERSION = "0.2.0";

export interface Paged<T> { items: T[]; next_cursor: string | null; limit: number }

export interface Meta {
  api_version: number; min_client_api: number; server_version: string; server_id: string; time: string;
  auth: { required: boolean };
  capabilities: Record<string, boolean | string>;
}

export type DisplayState =
  | "queued" | "running" | "awaiting_provider_session" | "awaiting_approval" | "blocked_quota" | "blocked"
  | "interrupted" | "completed" | "failed" | "cancelled";

export interface Cancellation {
  status: "none" | "requested" | "confirmed" | "too_late";
  requested_at: string | null; confirmed_at: string | null;
  in_flight_step: { step: string; side_effect: boolean } | null;
  may_still_finish_step: boolean; note: string;
}

export interface Run {
  id: string; task_id: string; task_title: string; task_kind: string; project_name?: string | null;
  state: string; display_state: DisplayState; state_reason: string | null; block_code: string | null;
  attempt: number; max_attempts: number; iteration: number; max_iterations: number;
  version: number; created_at: string; finished_at: string | null; cancellation?: Cancellation;
}

export interface RunDetail {
  run: Run; last_event_id: number;
  steps: { id: string; seq: number; name: string; state: string; side_effect: number; error: string | null }[];
  events: { id: number; ts: string; kind: string; message: string }[];
  artifacts: { id: string; kind: string; sha256: string; bytes: number; provenance: string }[];
  evidence: { id: string; kind: string; summary: string; created_at: string }[];
  approvals: { id: string; status: string; summary: string }[];
}

export interface RunEvents {
  items: { id: number; ts: string; kind: string; message: string }[];
  last_event_id: number; run_state: string; run_version: number; terminal: boolean;
}

export interface Project { id: string; slug: string; name: string; path: string | null; created_at: string; version: number }
export interface Task {
  id: string; title: string; kind: string; status: string; status_reason: string | null;
  project_id: string | null; project_name: string | null; version: number; created_at: string;
}

export interface Home {
  server_time: string;
  counts: { active_runs: number; blocked_runs: number; pending_approvals: number; pending_candidates: number };
  current_runs: Run[]; blocked_runs: Run[];
  providers: { provider: string; mode: string; billing: string }[];
}

export interface Approval {
  id: string; run_id: string | null; summary: string; status: string; action_hash: string; version: number;
  action: Record<string, unknown>; destructive: boolean; requested_at: string; expires_at: string;
  age_s: number; expires_in_s: number;
  review: { type: string; target: string; side_effects: string[]; content_preview: string; destructive: boolean };
  context?: { run: { id: string; state: string; task_title: string; task_kind: string } | null;
    evidence: { kind: string; summary: string; created_at: string }[] };
}

export interface Candidate {
  id: string; type: string; title: string; scope: "global" | "project"; status: string; confidence: number;
  score: number; validation: string; distinct_occurrences: number; distinct_sources: number; flags: string[];
  uncertainty: string; active: number; version: number; problem?: string; outcome?: string;
  evidence?: { role: string; excerpt: string; ref: string; kind: string; speaker: string; ts: string | null }[];
}

export interface Memory {
  id: string; title: string; scope: string; type: string; status: string; basis?: string; confidence: number;
  version: number; created_at?: string; last_reviewed_at?: string | null; body?: string;
  evidence?: { source: string }[]; excerpt?: string;
  tags?: string[]; explicit_tags?: string[]; sensitivity?: string; project_id?: string | null;
}
export interface NoteLinks {
  id: string;
  outgoing: { target: string; id: string; title: string }[];
  backlinks: { id: string; title: string; excerpt: string }[];
  unresolved: string[];
  unlinked_mentions: { id: string; title: string }[];
}
export interface GraphNode { id: string; kind: "memory" | "project" | "unresolved" | "tag" | "candidate"; label: string; degree: number; type?: string; status?: string; scope?: string; project_id?: string | null; created_at?: string }
export interface GraphEdge { source: string; target: string; kind: "link" | "scope" | "supersedes" | "tagged" | "promoted_to" }
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean }

export interface Provider { provider: string; mode: string; billing: string; detail: Record<string, unknown>; checked_at: string }
export interface SessionInfo { id: string; device_name: string; kind: string; created_at: string; last_seen_at: string; expires_at: string; revoked_at: string | null; current: boolean }
export interface Artifact { id: string; kind: string; sha256: string; provenance: string; content: string }
