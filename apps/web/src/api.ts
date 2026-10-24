export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export interface Project { id: string; slug: string; name: string; workspace_id: string | null; path: string | null; created_at: string }
export interface Task { id: string; title: string; kind: string; status: string; status_reason: string | null; project_id: string | null; project_name: string | null; spec: Record<string, unknown>; created_at: string }
export interface Run { id: string; task_id: string; task_title: string; task_kind: string; state: string; state_reason: string | null; attempt: number; max_attempts: number; iteration: number; max_iterations: number; created_at: string; finished_at: string | null }
export interface RunDetail {
  run: Run;
  steps: { id: string; seq: number; name: string; state: string; side_effect: number; error: string | null }[];
  events: { id: number; ts: string; kind: string; message: string }[];
  artifacts: { id: string; kind: string; path: string; sha256: string; bytes: number; provenance: string }[];
  evidence: { id: string; kind: string; summary: string; created_at: string }[];
  approvals: { id: string; status: string; summary: string }[];
}
export interface Approval { id: string; run_id: string; summary: string; status: string; action_hash: string; action: Record<string, unknown>; requested_at: string }
export interface Provider { provider: string; mode: string; billing: string; detail: Record<string, unknown>; checked_at: string }
export interface Health {
  version: string; db: string; schema: string[]; state_dir: string; host: string; port: number;
  run_counts: Record<string, number>; disk_free_gb: number; backup_status: string;
  last_backup: { path: string; bytes: number } | null; executors: string[];
  billable_env: Record<string, string[]>;
  startup: { reconcile?: { interrupted: string[]; uncertain_steps: number } };
}
