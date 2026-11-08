import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import { LOCAL_CATALOG } from "./localCatalog.generated";
import { LocalClient, LocalEngine, STANDALONE_URL, validateWidget } from "./localEngine";
import { KV } from "./storage";

class MemKV implements KV {
  m = new Map<string, string>();
  get(k: string) { return this.m.get(k) ?? null; }
  set(k: string, v: string) { this.m.set(k, v); }
  remove(k: string) { this.m.delete(k); }
  keys(p: string) { return [...this.m.keys()].filter((k) => k.startsWith(p)); }
}
const fresh = () => new LocalEngine(new MemKV(), () => new Date("2026-10-28T10:00:00Z"));
const err = (fn: () => unknown) => { try { fn(); } catch (e) { return e as ApiError; } throw new Error("expected an ApiError"); };

describe("the standalone engine: first launch", () => {
  it("starts with a welcome note and a Today's top 3 panel, and keeps them across restarts without duplicating", () => {
    const kv = new MemKV();
    const a = new LocalEngine(kv);
    expect((a.handle("GET", "/memories").data as { items: { title: string }[] }).items.map((n) => n.title)).toEqual(["Welcome to AIOS on your phone"]);
    expect((a.handle("GET", "/widgets").data as { items: { title: string }[] }).items.map((w) => w.title)).toEqual(["Today's top 3"]);
    const b = new LocalEngine(kv);                                                     // the app restarted
    expect((b.handle("GET", "/memories").data as { items: unknown[] }).items).toHaveLength(1);
    expect((b.handle("GET", "/widgets").data as { items: unknown[] }).items).toHaveLength(1);
  });
  it("speaks the same meta contract, says it is standalone, and needs no sign-in", () => {
    const e = fresh();
    const meta = e.handle("GET", "/meta").data as { api_version: number; server_version: string; auth: { required: boolean }; server_id: string };
    expect(meta).toMatchObject({ api_version: 1, server_version: "standalone", auth: { required: false } });
    expect(meta.server_id).toMatch(/^local_/);
    expect((e.handle("GET", "/meta").data as { server_id: string }).server_id).toBe(meta.server_id);       // the same identity every time
    expect(e.handle("GET", "/auth/me").status).toBe(200);
  });
});

describe("the universe on the phone", () => {
  it("builds the sun, a way to connect to the PC, and a probe for every panel, and stars from approved notes", () => {
    const e = fresh();
    const objs = (e.handle("GET", "/universe/objects").data as { items: { id: string; type: string }[] }).items;
    expect(objs.map((o) => o.id)).toEqual(expect.arrayContaining(["sun", "wormhole:pc"]));
    expect(objs.filter((o) => o.type === "probe")).toHaveLength(1);
    const uni = e.handle("GET", "/universe").data as { stars: unknown[]; you: { approved: number }; ais: unknown[] };
    expect(uni.stars).toHaveLength(1);
    expect(uni.you.approved).toBe(1);
    expect(uni.ais).toEqual([]);                                                        // no AIs live on the phone
    const card = e.handle("GET", "/universe/objects/wormhole:pc/card").data as { links: { label: string }[] };
    expect(card.links[0].label).toBe("Connect to my PC");
    expect(err(() => e.handle("GET", "/universe/objects/nope/card")).status).toBe(404);
  });
});

describe("My Day panels", () => {
  it("offers only the ready-made panels that need no Claude, and adds one from the catalog", () => {
    const e = fresh();
    const cat = e.handle("GET", "/widgets/catalog").data as typeof LOCAL_CATALOG;
    expect(cat.items.every((i) => !i.needs_claude && (i.kind as string) !== "routine")).toBe(true);
    expect(cat.items.map((i) => i.id)).toEqual(expect.arrayContaining(["top3", "water", "household", "mission"]));
    const r = e.handle("POST", "/widgets/from-catalog", { body: { template: "household" } });
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ kind: "facts", title: "Household vault" });
    expect(err(() => e.handle("POST", "/widgets/from-catalog", { body: { template: "briefing" } })).code).toBe("no_such_template");
  });
  it("changes and removes a panel, and validates exactly what is stored", () => {
    const e = fresh();
    const w = e.handle("POST", "/widgets", { body: { kind: "counter", title: "Water", config: { value: 2, step: 1 } } }).data as { id: string };
    expect(e.handle("PUT", `/widgets/${w.id}`, { body: { config: { value: 3, step: 1 } } }).data).toMatchObject({ config: { value: 3, step: 1 } });
    expect(err(() => e.handle("PUT", `/widgets/${w.id}`, { body: { config: { value: 3, surprise: 1 } } })).message).toContain("unknown setting");
    expect(e.handle("DELETE", `/widgets/${w.id}`).status).toBe(204);
    expect(err(() => e.handle("DELETE", `/widgets/${w.id}`)).status).toBe(404);
  });
  it("refuses the same nonsense the server refuses", () => {
    const bad: [string, unknown][] = [
      ["counter", { value: 1.5 }], ["counter", { step: 0 }], ["habit", { days: ["tomorrow"] }], ["habit", { per_week: 9 }], ["timer", { focus: 0 }],
      ["facts", { items: [{ label: "x" }] }], ["facts", { items: [{ label: "", value: "y" }] }], ["mission", { target: "next friday" }], ["mission", { steps: [{ text: "" }] }],
      ["checklist", { items: [{ text: "a", extra: 1 }] }], ["note", { text: "x".repeat(501) }], ["checklist", "nope"], ["nonsense", {}], ["routine", { prompt: "hi" }],
    ];
    for (const [kind, cfg] of bad) expect(err(() => validateWidget(kind, "T", cfg)).status, `${kind} ${JSON.stringify(cfg)}`).toBe(422);
    expect(validateWidget("facts", " Vault ", { items: [{ label: " Filter ", value: "16x25x4" }] })).toEqual({ title: "Vault", config: { items: [{ label: "Filter", value: "16x25x4" }] } });
    expect(validateWidget("mission", "Trip", {}).config).toEqual({ target: "", steps: [], note: "" });
  });
  it("holds up to 24 panels", () => {
    const e = fresh();
    for (let i = 0; i < 23; i++) e.handle("POST", "/widgets", { body: { kind: "note", title: `n${i}`, config: { text: "" } } });
    expect(err(() => e.handle("POST", "/widgets", { body: { kind: "note", title: "one too many", config: {} } })).code).toBe("too_many_widgets");
  });
  it("says plainly that running a routine needs the PC, never pretending", () => {
    const e = fresh();
    const w = (e.handle("GET", "/widgets").data as { items: { id: string }[] }).items[0];
    const r = err(() => e.handle("POST", `/widgets/${w.id}/run`));
    expect([r.status, r.code]).toEqual([409, "needs_pc"]);
    expect(r.message).toContain("Connect to my PC");
  });
});

describe("notes on the phone", () => {
  it("creates, reads, searches, tags and links notes", () => {
    const e = fresh();
    const a = e.handle("POST", "/memories", { body: { title: "Furnace", body: "Filter 16x25x4 #home see [[Welcome to AIOS on your phone]] and [[Missing]]" } }).data as { id: string; tags: string[] };
    expect(a.tags).toContain("home");
    const found = (e.handle("GET", "/memories", { query: { q: "16x25x4" } }).data as { items: { title: string; excerpt?: string }[] }).items;
    expect(found.map((n) => n.title)).toEqual(["Furnace"]);
    expect(found[0].excerpt).toContain("Filter");
    expect((e.handle("GET", "/memories/tags").data as { items: { tag: string }[] }).items.map((t) => t.tag)).toEqual(expect.arrayContaining(["home", "welcome"]));
    const links = e.handle("GET", `/memories/${a.id}/links`).data as { outgoing: { title: string }[]; unresolved: string[] };
    expect(links.outgoing.map((l) => l.title)).toEqual(["Welcome to AIOS on your phone"]);
    expect(links.unresolved).toEqual(["Missing"]);
    const graph = e.handle("GET", "/graph").data as { nodes: unknown[]; edges: { source: string }[] };
    expect(graph.nodes).toHaveLength(2); expect(graph.edges).toHaveLength(1); expect(graph.edges[0].source).toBe(a.id);
  });
  it("keeps edits safe: a stale version is refused and nothing is saved", () => {
    const e = fresh();
    const n = e.handle("POST", "/memories", { body: { title: "Plan", body: "v1" } }).data as { id: string; version: number };
    const ok = e.handle("PUT", `/memories/${n.id}`, { body: { body: "v2", expected_version: 1 } }).data as { version: number; body: string };
    expect([ok.version, ok.body]).toEqual([2, "v2"]);
    const stale = err(() => e.handle("PUT", `/memories/${n.id}`, { body: { body: "v3", expected_version: 1 } }));
    expect([stale.status, stale.code]).toEqual([409, "version_conflict"]);
    expect((e.handle("GET", `/memories/${n.id}`).data as { body: string }).body).toBe("v2");
  });
  it("forgets a note, and refuses an empty title", () => {
    const e = fresh();
    const n = e.handle("POST", "/memories", { body: { title: "Temp" } }).data as { id: string };
    expect(e.handle("DELETE", `/memories/${n.id}`).status).toBe(204);
    expect(err(() => e.handle("GET", `/memories/${n.id}`)).status).toBe(404);
    expect(err(() => e.handle("POST", "/memories", { body: { title: "  " } })).status).toBe(422);
  });
  it("records what you did in the receipts", () => {
    const e = fresh();
    e.handle("POST", "/memories", { body: { title: "Receipt me" } });
    const items = (e.handle("GET", "/receipts").data as { items: { kind: string; summary: string }[] }).items;
    expect(items[0]).toMatchObject({ kind: "memory.created", summary: 'Saved the note "Receipt me".' });
  });
});

describe("what only the PC can do", () => {
  it("says so for asking Claude, companions, the Rover and the computer check, instead of faking an answer", () => {
    const e = fresh();
    for (const path of ["/assist", "/companion/gemini", "/rover", "/system-scan", "/conversations/x/messages", "/universe/objects/home/actions/run_health_check"]) {
      const r = err(() => e.handle("POST", path, { body: {} }));
      expect([r.status, r.code], path).toEqual([409, "needs_pc"]);
    }
  });
  it("lists nothing for approvals, runs and projects rather than failing", () => {
    const e = fresh();
    for (const path of ["/approvals", "/runs", "/candidates", "/projects"]) expect((e.handle("GET", path).data as { items: unknown[] }).items).toEqual([]);
  });
});

describe("the client wrapper", () => {
  it("is an ordinary client to every screen: get/post work and errors are ApiError", async () => {
    const c = new LocalClient(fresh());
    expect(c.baseUrl).toBe(STANDALONE_URL);
    expect((await c.get<{ api_version: number }>("/meta")).api_version).toBe(1);
    const made = await c.post<{ id: string }>("/memories", { title: "Via client" });
    expect(made.status).toBe(201);
    await expect(c.get("/memories/missing")).rejects.toBeInstanceOf(ApiError);
    await expect(c.post("/assist", { prompt: "hi" })).rejects.toMatchObject({ code: "needs_pc" });
  });
});
