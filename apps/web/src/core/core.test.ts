import { describe, expect, it, vi } from "vitest";
import { AiosClient, ApiError, NetworkError, withRetry } from "./client";
import { SummaryCache } from "./cache";
import { ConnectionMonitor } from "./connection";
import { DraftStore, draftPayload } from "./drafts";
import { monitorRun } from "./monitor";
import { ServerRegistry, checkServerUrl } from "./servers";
import { MemoryKV } from "./storage";
import { err, fakeServer, META } from "../test/fakeServer";

describe("AiosClient", () => {
  it("sends bearer + idempotency + client-version headers, no cookies", async () => {
    const s = fakeServer({ "POST /tasks": () => ({ status: 201, body: { ok: 1 } }) });
    const c = new AiosClient("https://aios.example", { mode: "bearer", token: "tok123" });
    await c.post("/tasks", { a: 1 }, { idempotencyKey: "key-abcdefgh" });
    const h = s.calls[0].headers;
    expect(h.authorization).toBe("Bearer tok123");
    expect(h["idempotency-key"]).toBe("key-abcdefgh");
    expect(h["x-aios-client"]).toMatch(/api=1/);
    expect(h["x-csrf-token"]).toBeUndefined();
    expect((s.fetch.mock.calls[0][1] as RequestInit).credentials).toBe("omit");
  });

  it("cookie mode sends the CSRF header on writes only", async () => {
    document.cookie = "aios_csrf=csrf-xyz";
    const s = fakeServer({ "GET /home": () => ({}), "POST /runs": () => ({}) });
    const c = new AiosClient("", { mode: "cookie" });
    await c.get("/home");
    await c.post("/runs", {});
    expect(s.calls[0].headers["x-csrf-token"]).toBeUndefined();
    expect(s.calls[1].headers["x-csrf-token"]).toBe("csrf-xyz");
    expect(s.calls[1].headers.authorization).toBeUndefined();
  });

  it("parses structured errors and fires the right hooks", async () => {
    fakeServer({ "GET /a": () => err(401, "unauthenticated", "Sign in required"), "GET /b": () => err(426, "client_too_old"), "GET /c": () => err(409, "version_conflict", "changed", { current_version: 7 }) });
    const onUnauthenticated = vi.fn(), onIncompatible = vi.fn();
    const c = new AiosClient("", { mode: "cookie" }, { onUnauthenticated, onIncompatible });
    await expect(c.get("/a")).rejects.toMatchObject({ status: 401, code: "unauthenticated", requestId: "req1" });
    await expect(c.get("/b")).rejects.toBeInstanceOf(ApiError);
    const e = (await c.get("/c").catch((x) => x)) as ApiError;
    expect(e.details.current_version).toBe(7);
    expect(onUnauthenticated).toHaveBeenCalledOnce();
    expect(onIncompatible).toHaveBeenCalledOnce();
  });

  it("network failure becomes NetworkError (outcome unknown), distinct from a server answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(new AiosClient("", { mode: "cookie" }).get("/x")).rejects.toMatchObject({ kind: "offline" });
  });

  it("times out", async () => {
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))))));
    await expect(new AiosClient("", { mode: "cookie" }).get("/x", { timeoutMs: 20 })).rejects.toMatchObject({ kind: "timeout" });
  });

  it("retries only network errors, never server answers", async () => {
    const sleep = async () => {};
    let n = 0;
    await expect(withRetry(async () => { if (++n < 3) throw new NetworkError("offline", "x"); return "ok"; }, 3, 1, sleep)).resolves.toBe("ok");
    expect(n).toBe(3);
    let m = 0;
    await expect(withRetry(async () => { m++; throw new ApiError(409, "version_conflict", "x"); }, 3, 1, sleep)).rejects.toBeInstanceOf(ApiError);
    expect(m).toBe(1);
  });
});

describe("server addresses", () => {
  it("accepts HTTPS only and rejects cleartext, credentials and paths", () => {
    expect(checkServerUrl("https://pc.tail.ts.net/")).toEqual({ ok: true, url: "https://pc.tail.ts.net" });
    for (const bad of ["http://pc.tail.ts.net", "http://192.168.1.5:8765", "ftp://x", "https://u:p@host", "https://host/path", "not a url", "https://host?x=1"])
      expect(checkServerUrl(bad).ok).toBe(false);
    expect(checkServerUrl("http://10.0.2.2:8765").ok).toBe(false);
    expect(checkServerUrl("http://10.0.2.2:8765", true).ok).toBe(true);        // explicit dev-only loopback alias
    expect(checkServerUrl("http://evil.example", true).ok).toBe(false);
  });

  it("detects a different server at the same address and cleans up on removal", async () => {
    const removed: string[] = [];
    const r = new ServerRegistry(new MemoryKV(), (s) => void removed.push(s.id));
    const s = r.add("Home", "https://a.example");
    expect(r.recordServerId(s.id, "srv_1")).toBe("first");
    expect(r.recordServerId(s.id, "srv_1")).toBe("same");
    expect(r.recordServerId(s.id, "srv_2")).toBe("changed");
    r.adoptServerId(s.id, "srv_2");
    expect(r.recordServerId(s.id, "srv_2")).toBe("same");
    await r.remove(s.id);
    expect(removed).toEqual([s.id]);
    expect(r.list()).toEqual([]);
  });
});

describe("summary cache", () => {
  it("is off by default, partitioned per server, and clearable", () => {
    const kv = new MemoryKV();
    let on = false;
    const c = new SummaryCache(kv, () => on);
    c.put("srvA", "home", { n: 1 });
    expect(kv.keys("aios.cache")).toEqual([]);                                  // opt-in only
    on = true;
    c.put("srvA", "home", { n: 1 });
    c.put("srvB", "home", { n: 2 });
    expect(c.get<{ n: number }>("srvA", "home")!.value.n).toBe(1);
    expect(c.get<{ n: number }>("srvB", "home")!.value.n).toBe(2);              // never one server's data for another
    expect(c.get("srvC", "home")).toBeNull();
    c.clearPartition("srvA");
    expect(c.get("srvA", "home")).toBeNull();
    expect(c.get("srvB", "home")).not.toBeNull();
    c.clearAll();
    expect(kv.keys("aios.cache")).toEqual([]);
  });

  it("returns nothing when disabled even if data exists", () => {
    const kv = new MemoryKV();
    let on = true;
    const c = new SummaryCache(kv, () => on);
    c.put("s", "projects", [1]);
    on = false;
    expect(c.get("s", "projects")).toBeNull();
  });
});

describe("drafts", () => {
  const P = "srvA";
  it("a draft is local only and not a task until sent", async () => {
    const s = fakeServer({});
    const d = new DraftStore(new MemoryKV());
    d.add(P, "remember the milk");
    expect(d.list(P)).toHaveLength(1);
    expect(d.pendingCount(P)).toBe(1);
    expect(s.calls).toHaveLength(0);                                            // nothing touched the network
  });

  it("keeps ONE idempotency key across an unknown-outcome failure and a later retry", async () => {
    let attempt = 0;
    const s = fakeServer({ "POST /tasks": (c) => (++attempt === 1 ? Promise.reject(new TypeError("net")) : { status: 201, body: { task: { id: "tsk_1" } } }) });
    const store = new DraftStore(new MemoryKV());
    const client = new AiosClient("", { mode: "bearer", token: "t" });
    const d = store.add(P, "ship it");
    const first = await store.send(P, client, d.id);
    expect(first.status).toBe("unknown_outcome");
    const second = await store.send(P, client, d.id);
    expect(second.status).toBe("sent");
    expect(second.taskId).toBe("tsk_1");
    const keys = s.calls.map((c) => c.headers["idempotency-key"]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);                                              // retry cannot duplicate work
    expect(keys[0]).toBe(d.idempotencyKey);
    expect(s.calls[1].body).toEqual({ ...draftPayload(d), start_run: false });
  });

  it("surfaces a conflict instead of overwriting, and forbids editing after an attempt", async () => {
    fakeServer({ "POST /tasks": () => err(422, "idempotency_key_reuse") });
    const store = new DraftStore(new MemoryKV());
    const d = store.add(P, "v1");
    const r = await store.send(P, new AiosClient("", { mode: "bearer", token: "t" }), d.id);
    expect(r.status).toBe("conflict");
    expect(() => store.update(P, d.id, { text: "v2" })).toThrow(/already sent once/);
  });

  it("never uploads on its own; sendMany sends exactly the ids chosen", async () => {
    const s = fakeServer({ "POST /tasks": () => ({ status: 201, body: { task: { id: "t" } } }) });
    const store = new DraftStore(new MemoryKV());
    const client = new AiosClient("", { mode: "bearer", token: "t" });
    const a = store.add(P, "a"), b = store.add(P, "b"), c = store.add(P, "c");
    await store.sendMany(P, client, [a.id, c.id]);
    expect(s.calls).toHaveLength(2);
    expect(store.list(P).find((x) => x.id === b.id)!.status).toBe("draft");
  });

  it("drafts are partitioned by server and wiped with it", () => {
    const store = new DraftStore(new MemoryKV());
    store.add("srvA", "x");
    store.add("srvB", "y");
    expect(store.list("srvA").map((d) => d.text)).toEqual(["x"]);
    store.clear("srvA");
    expect(store.list("srvA")).toEqual([]);
    expect(store.list("srvB")).toHaveLength(1);
  });
});

describe("connection monitor", () => {
  it("connected -> stale/disconnected -> connected, and flags incompatible servers", async () => {
    let mode: "ok" | "down" | "old" = "ok";
    fakeServer({ "GET /meta": () => (mode === "down" ? Promise.reject(new TypeError("net")) : { body: { ...META, ...(mode === "old" ? { min_client_api: 9 } : {}) } }) });
    const m = new ConnectionMonitor(new AiosClient("", { mode: "cookie" }), { intervalMs: 1e9 });
    m.start();
    await vi.waitFor(() => expect(m.store.get().state).toBe("connected"));
    mode = "down";
    await m.tick();
    expect(m.store.get().state).not.toBe("connected");
    await m.tick();
    expect(m.store.get().state).toBe("disconnected");
    expect(m.store.get().lastOkAt).toBeTruthy();                                // last good contact is kept, not faked
    mode = "ok";
    await m.tick();
    expect(m.store.get().state).toBe("connected");
    mode = "old";
    await m.tick();
    expect(m.store.get().state).toBe("incompatible");
    m.stop();
  });
});

const tick = () => new Promise<void>((r) => setTimeout(r, 1));   // must yield a macrotask or the loop starves the runner

describe("run monitor reconnect + resync", () => {
  const snap = (version: number, last: number, state = "running") => ({ run: { id: "r", state, version, display_state: state }, last_event_id: last, steps: [], events: [], artifacts: [], evidence: [], approvals: [] });
  it("survives network loss, resyncs from a fresh snapshot, never repeats events, and stops at terminal", async () => {
    let evCalls = 0, snaps = 0;
    fakeServer({
      "GET /runs/r": () => ({ body: ++snaps === 1 ? snap(1, 2) : snap(2, 5, "succeeded") }),
      "GET /runs/r/events": (c) => {
        evCalls++;
        if (evCalls === 1) return Promise.reject(new TypeError("net"));                    // connection drop
        return { body: { items: [{ id: 6, ts: "t", kind: "x", message: "m" }], last_event_id: 6, run_state: "running", run_version: 1, terminal: false } };
      },
    });
    const links: string[] = [], got: number[] = [];
    let snapshots = 0;
    const stop = monitorRun(new AiosClient("", { mode: "cookie" }), "r", {
      onSnapshot: () => snapshots++, onEvents: (i) => got.push(...i.map((e) => e.id)), onLink: (s) => links.push(s),
    }, { sleep: tick, intervalMs: 0 });
    await vi.waitFor(() => expect(links).toContain("ended"));
    stop();
    expect(links).toContain("reconnecting");
    expect(snapshots).toBeGreaterThanOrEqual(2);                                // initial + resync after the drop
    expect(new Set(got).size).toBe(got.length);
  });

  it("reloads the snapshot on resync_required and stops on 401", async () => {
    let n = 0, snaps = 0;
    fakeServer({
      "GET /runs/r": () => { snaps++; return { body: snap(1, 1) }; },
      "GET /runs/r/events": () => (++n === 1 ? err(409, "resync_required") : n >= 3 ? err(401, "unauthenticated")
        : { body: { items: [], last_event_id: 1, run_state: "running", run_version: 1, terminal: false } }),
    });
    const links: string[] = [];
    let snapshots = 0;
    monitorRun(new AiosClient("", { mode: "cookie" }), "r", { onSnapshot: () => snapshots++, onEvents: () => {}, onLink: (s) => links.push(s) }, { sleep: tick, intervalMs: 0 });
    await vi.waitFor(() => expect(links).toContain("unauthenticated"));
    expect(snapshots).toBeGreaterThanOrEqual(2);
  });
});
