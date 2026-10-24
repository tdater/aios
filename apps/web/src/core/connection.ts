import { AiosClient, ApiError, NetworkError } from "./client";
import { API_VERSION, Meta } from "./types";

export type ConnState = "connecting" | "connected" | "stale" | "disconnected" | "incompatible" | "unauthenticated";
export interface ConnSnapshot { state: ConnState; lastOkAt: string | null; meta: Meta | null; detail?: string }

export class Store<T> {
  private subs = new Set<() => void>();
  constructor(private v: T) {}
  get = () => this.v;
  set(v: T) {
    this.v = v;
    this.subs.forEach((f) => f());
  }
  subscribe = (f: () => void) => {
    this.subs.add(f);
    return () => void this.subs.delete(f);
  };
}

/** Polls the PUBLIC /meta endpoint (cheap, no secrets) to know whether the server is reachable and
 *  compatible. Reachability != authenticated: auth failures surface from real calls. */
export class ConnectionMonitor {
  readonly store = new Store<ConnSnapshot>({ state: "connecting", lastOkAt: null, meta: null });
  private timer: ReturnType<typeof setTimeout> | null = null;
  private fails = 0;
  private stopped = true;
  constructor(private client: AiosClient, private opts: { intervalMs?: number; staleAfterMs?: number; now?: () => number } = {}) {}

  start() {
    this.stopped = false;
    void this.tick();
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
  markUnauthenticated() {
    this.store.set({ ...this.store.get(), state: "unauthenticated" });
  }
  async tick() {
    if (this.stopped) return;
    const now = this.opts.now ?? Date.now;
    try {
      const meta = await this.client.get<Meta>("/meta", { timeoutMs: 6000 });
      this.fails = 0;
      const incompatible = meta.api_version < API_VERSION || API_VERSION < meta.min_client_api;
      this.store.set({ state: incompatible ? "incompatible" : this.store.get().state === "unauthenticated" ? "unauthenticated" : "connected",
        lastOkAt: new Date(now()).toISOString(), meta,
        detail: incompatible ? `Server API ${meta.api_version} (needs client ≥ ${meta.min_client_api}); this app speaks ${API_VERSION}.` : undefined });
    } catch (e) {
      this.fails++;
      const cur = this.store.get();
      const last = cur.lastOkAt ? now() - Date.parse(cur.lastOkAt) : Infinity;
      const detail = e instanceof NetworkError ? e.message : e instanceof ApiError ? e.message : String(e);
      this.store.set({ ...cur, detail,
        state: this.fails >= 2 ? "disconnected" : last > (this.opts.staleAfterMs ?? 30000) ? "stale" : cur.state === "connecting" ? "connecting" : "stale" });
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.tick(), this.opts.intervalMs ?? 10000);
  }
}
