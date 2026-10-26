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

// ---- Workspace: conversations with a provider about one project (docs/api-v1.md, "Conversations")
export interface Conversation {
  id: string; project_id: string; project_name?: string; workspace_id: string; title: string; provider: "claude";
  model: string | null; status: "open" | "archived"; session_id: string | null; worktree_path: string | null;
  branch: string | null; base_revision: string | null; head_revision: string | null;
  created_at: string; updated_at: string; version: number;
}
export type MessageKind = "message" | "status" | "patch" | "verification" | "review";
export interface ConvMessage {
  id: string; conversation_id: string; seq: number; role: "user" | "assistant" | "system";
  author_kind: "user" | "provider" | "aios"; author: string; kind: MessageKind; content: string;
  run_id: string | null; meta: Record<string, unknown> | null; created_at: string;
}
export interface Finding {
  id: string; severity: "high" | "medium" | "low"; title: string; detail: string; file: string | null;
  line: number | null; suggestion: string | null; grounded: boolean | null;
}
export interface Readiness { ready: boolean; verified: boolean | null; reviewed: boolean; high_findings: number; reasons: string[]; head_revision: string | null }
export interface AppliedInfo { applied: boolean; commit?: string; previous_head?: string; tree_matches_reviewed?: boolean; head_revision: string; target_branch: string; at: string }
export interface QuotaWindow { utilization?: number | null; resets_at?: number | null; status?: string | null }
export interface Quota { status?: string | null; overage?: string | null; five_hour?: QuotaWindow; seven_day?: QuotaWindow }
export interface TurnInfo {
  at: string; run_id: string; role?: "writer" | "reviewer"; model?: string; client_version?: string; permission_mode?: string; tools: string[];
  unexpected_tools: string[]; api_key_source?: string | null; builtin_plugins: string[]; external_plugins: string[];
  mcp_servers: string[]; permission_denials: unknown[]; num_turns?: number; cost_estimate_usd?: number | null;
  rate_limit?: Quota | null; cancelled?: boolean; timed_out?: boolean;
}
export interface ConversationStatus {
  provider: { name: string; mode: string; billing: string; client_version?: string | null; plan?: string | null; auth_method?: string | null; logged_in?: boolean | null; checked_at?: string | null };
  session: { id: string | null; resumable: boolean; model: string };
  permissions: Record<string, string | string[]>;
  workspace: { worktree: string | null; branch: string | null; base_revision: string | null; head_revision: string | null };
  last_turn: TurnInfo | null; last_review_turn: TurnInfo | null; quota: Quota | null; quota_note: string; run: Run | null;
  pending_approvals: { id: string; summary: string; type?: string | null; requested_at: string; expires_at: string }[];
}
export interface ConversationView {
  conversation: Conversation; project: { id: string; name: string }; verify_command: string[] | null;
  messages: ConvMessage[]; status: ConversationStatus;
  changes: { patch: ConvMessage | null; verification: ConvMessage | null; review: ConvMessage | null; readiness: Readiness; applied?: AppliedInfo | null };
  context: Record<string, { kind: string; ref: string; version: string | null; sha256: string }[]>;
}

// ---- Insights: the Constellation and the Skyline (docs/api-v1.md, "Insights")
export type StarState = "fresh" | "stale" | "candidate" | "superseded";
export interface Star {
  id: string; title: string; type: "preference" | "fact" | "decision" | "lesson" | "procedure"; scope: "global" | "project";
  project_id: string | null; project: string | null; state: StarState; uses: number; verified_uses: number; hollow: boolean;
  last_used: string | null; last_verified: string | null; brightness: number;
}
export interface Constellation {
  stars: Star[]; links: { kind: "supersedes"; from: string; to: string }[]; clusters: string[]; link_kinds: string[];
  totals: { stars: number; verified: number; hollow: number; stale: number };
}
export interface StarEvidence {
  memory_id: string; total_uses: number; verified_uses: number;
  uses: { run_id: string; conversation_id: string; conversation: string | null; memory_version: string | null; at: string; verified: boolean }[];
}
export interface Building { id: string; name: string; floors: number; working: number; waiting: number; conversations: number }
export interface Skyline { projects: Building[]; totals: { projects: number; floors: number; waiting: number } }

// ---- The Universe (docs/universe.md): you, your AIs, your memories, and what is waiting
export type ShareLevel = "none" | "public" | "private";
export interface AiPlanet { provider: string; name: string; mode: string; level: ShareLevel; default_level: ShareLevel; told: string[]; told_count: number }
export interface Universe {
  you: { approved: number; suggested: number; learning: boolean };
  ais: AiPlanet[]; stars: Star[]; links: Constellation["links"]; clusters: string[]; totals: Constellation["totals"];
  comets: { approvals: number; blocked: number; to_review: number }; paused: boolean;
}
export interface SharingRow { provider: string; name: string; level: ShareLevel; default_level: ShareLevel; told_count: number }
export interface ImportResult { created: number; memory_ids: string[]; duplicates: number; skipped: { line: string; reason: string }[]; source: string }

// ---- Abilities, receipts, widgets, system scan (docs/api-v1.md, "Abilities")
export interface AbilityInfo { name: string; title: string; can_see: string[]; can_do: string[]; cannot: string[]; enabled: boolean }
export interface AbilityStatus { paused: boolean; abilities: AbilityInfo[]; planned: { name: string; title: string }[] }
export interface Receipt { id: string; ts: string; actor: string; kind: string; summary: string; changed: number }
export interface ScanResult { facts: Record<string, unknown>; suggestions: { id: string; level: "ok" | "info" | "attention"; text: string }[]; changed_anything: boolean }
export type WidgetData =
  | { id: string; kind: "counter"; title: string; config: { value: number; step: number } }
  | { id: string; kind: "checklist"; title: string; config: { items: { text: string; done: boolean }[] } }
  | { id: string; kind: "note"; title: string; config: { text: string } };
