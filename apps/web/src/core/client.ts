import { API_VERSION, APP_NAME, APP_VERSION } from "./types";

/** Server answered with a structured error. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
    public requestId = "",
  ) {
    super(message);
  }
}

/** The request never produced a server answer. The outcome of a write is UNKNOWN. */
export class NetworkError extends Error {
  constructor(public kind: "offline" | "timeout", message: string) {
    super(message);
  }
}

export type AuthMode = { mode: "cookie" } | { mode: "bearer"; token: string };
export interface ClientHooks {
  onUnauthenticated?: () => void;
  onIncompatible?: () => void;
}
export interface ReqOpts {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  idempotencyKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : "";
}

export const newKey = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `k${Date.now()}${Math.random().toString(16).slice(2)}`) + "";

export class AiosClient {
  constructor(public baseUrl: string, private auth: AuthMode | null, private hooks: ClientHooks = {}) {}

  setAuth(a: AuthMode | null) {
    this.auth = a;
  }

  async request<T>(method: string, path: string, o: ReqOpts = {}): Promise<{ data: T; status: number; headers: Headers }> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`, globalThis.location?.href ?? "http://localhost");
    for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-AIOS-Client": `${APP_NAME}/${APP_VERSION} api=${API_VERSION}`,
    };
    if (o.body !== undefined) headers["Content-Type"] = "application/json";
    if (this.auth?.mode === "bearer") headers.Authorization = `Bearer ${this.auth.token}`;
    if (this.auth?.mode === "cookie" && !SAFE.has(method)) headers["X-CSRF-Token"] = readCookie("aios_csrf");
    if (o.idempotencyKey) headers["Idempotency-Key"] = o.idempotencyKey;

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort("timeout"), o.timeoutMs ?? 15000);
    o.signal?.addEventListener("abort", () => ctl.abort(o.signal?.reason));
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method,
        headers,
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
        credentials: this.auth?.mode === "cookie" ? "same-origin" : "omit",
        signal: ctl.signal,
        cache: "no-store",
      });
    } catch (e) {
      if (ctl.signal.aborted && ctl.signal.reason === "timeout") throw new NetworkError("timeout", "The server did not answer in time.");
      throw new NetworkError("offline", "Could not reach the server.");
    } finally {
      clearTimeout(timer);
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const err = (json as { error?: { code: string; message: string; details?: Record<string, unknown> }; request_id?: string } | null);
      const e = new ApiError(res.status, err?.error?.code ?? "http_error", err?.error?.message ?? res.statusText,
        err?.error?.details ?? {}, err?.request_id ?? "");
      if (res.status === 401) this.hooks.onUnauthenticated?.();
      if (res.status === 426) this.hooks.onIncompatible?.();
      throw e;
    }
    return { data: json as T, status: res.status, headers: res.headers };
  }

  get = <T,>(path: string, o?: ReqOpts) => this.request<T>("GET", path, o).then((r) => r.data);
  post = <T,>(path: string, body?: unknown, o: ReqOpts = {}) => this.request<T>("POST", path, { ...o, body: body ?? {} });
  patch = <T,>(path: string, body: unknown, o: ReqOpts = {}) => this.request<T>("PATCH", path, { ...o, body });
  put = <T,>(path: string, body: unknown, o: ReqOpts = {}) => this.request<T>("PUT", path, { ...o, body });
  delete = <T,>(path: string, o: ReqOpts = {}) => this.request<T>("DELETE", path, o);
}

/** Retry only when the failure was a network failure AND repeating is safe (read, or keyed write). */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 400, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!(e instanceof NetworkError) || i === attempts - 1) throw e;
      await sleep(baseMs * 2 ** i + Math.random() * 100);
    }
  }
  throw last;
}
