import { vi } from "vitest";

export interface Call { method: string; path: string; headers: Record<string, string>; body: unknown; query: URLSearchParams }
export type Handler = (c: Call) => { status?: number; body?: unknown; headers?: Record<string, string> } | Promise<{ status?: number; body?: unknown; headers?: Record<string, string> }>;

/** Minimal in-process stand-in for the AIOS API. Route key: "METHOD /path" (without /api/v1). */
export function fakeServer(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input), "http://localhost");
    const path = u.pathname.replace(/^\/api\/v1/, "");
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
    const call: Call = { method, path, headers, body: init?.body ? JSON.parse(String(init.body)) : undefined, query: u.searchParams };
    calls.push(call);
    const h = routes[`${method} ${path}`] ?? Object.entries(routes).find(([k]) => k.endsWith("*") && `${method} ${path}`.startsWith(k.slice(0, -1)))?.[1];
    if (!h) return new Response(JSON.stringify({ error: { code: "not_found", message: `no route ${method} ${path}`, details: {} }, request_id: "t" }), { status: 404 });
    const r = await h(call);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  };
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return { calls, fetch: fn, count: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path).length };
}

export const err = (status: number, code: string, message = code, details: Record<string, unknown> = {}) =>
  ({ status, body: { error: { code, message, details }, request_id: "req1" } });

export interface FakeNote { id: string; title: string; type?: string; status?: string; tags?: string[]; body?: string; scope?: string; version?: number; created_at?: string; project_id?: string | null }
export const noteRow = (n: FakeNote) => ({ id: n.id, title: n.title, type: n.type ?? "fact", status: n.status ?? "approved", scope: n.scope ?? "global", confidence: 0.5, version: n.version ?? 1,
  tags: n.tags ?? [], project_id: n.project_id ?? null, created_at: n.created_at ?? `2026-01-01T00:00:0${n.id.length % 10}+00:00`, last_reviewed_at: null });
export const noteFull = (n: FakeNote) => ({ ...noteRow(n), body: n.body ?? "", explicit_tags: n.tags ?? [], basis: "observation", sensitivity: "private", evidence: [] });
export const NOTES: FakeNote[] = [
  { id: "mem_a", title: "Gradle caching", type: "fact", tags: ["build", "android/build"], body: "# Gradle caching\n\nSee [[Android build checklist]] and [[Missing note]] #android\n\n> [!tip] Keep it on\n> yes" },
  { id: "mem_b", title: "Android build checklist", type: "procedure", tags: ["android"], body: "- [x] tests\n- [ ] sign\n\nLinks back: [[Gradle caching]]" },
  { id: "mem_c", title: "No force push", type: "preference", status: "candidate", tags: [], body: "Never force push." },
];

export const META = { api_version: 1, min_client_api: 1, server_version: "0.2.0", server_id: "srv_test1", time: "2026-01-01T00:00:00+00:00", auth: { required: true }, capabilities: {} };
export const HOME = {
  server_time: "2026-01-01T00:00:00+00:00",
  counts: { active_runs: 1, blocked_runs: 1, pending_approvals: 2, pending_candidates: 3 },
  current_runs: [{ id: "run_1", task_id: "t1", task_title: "Audit sample", task_kind: "audit.workspace", state: "running", display_state: "running", state_reason: null, block_code: null, attempt: 1, max_attempts: 3, iteration: 0, max_iterations: 1000, version: 2, created_at: "2026-01-01T00:00:00+00:00", finished_at: null }],
  blocked_runs: [{ id: "run_2", task_id: "t2", task_title: "Ask Gemini", task_kind: "provider.task", state: "blocked", display_state: "blocked", state_reason: "provider 'gemini' unavailable", block_code: "provider_unavailable", attempt: 0, max_attempts: 3, iteration: 0, max_iterations: 1000, version: 3, created_at: "2026-01-01T00:00:00+00:00", finished_at: null }],
  providers: [{ provider: "claude", mode: "interactive", billing: "subscription" }, { provider: "gemini", mode: "unavailable", billing: "n/a" }],
};
