import { afterEach, describe, expect, it, vi } from "vitest";
import { AiosClient } from "./client";
import { dailyTitle, ensureDailyNote } from "./daily";
import { colorKey, projectSlot, timeRange, visibleAt } from "./graph";
import { MemoryKV } from "./storage";
import { GraphData, GraphNode } from "./types";
import { Workspace } from "./workspace";

const mem = (id: string, created_at?: string, over: Partial<GraphNode> = {}): GraphNode => ({ id, kind: "memory", label: id, degree: 0, created_at, ...over });

describe("pinned tabs", () => {
  const open = (ws: Workspace, ...ids: string[]) => ids.forEach((id) => ws.visit({ tab: "knowledge", id }, id));
  it("pinning moves a tab first, unpinning keeps it in place, and the flag survives a reload", () => {
    const kv = new MemoryKV();
    const ws = new Workspace(kv, "s");
    open(ws, "a", "b", "c");
    expect(ws.togglePin("#/knowledge/c")).toBe(true);
    expect(ws.store.get().tabs.map((t) => t.title)).toEqual(["c", "a", "b"]);
    expect(new Workspace(kv, "s").store.get().tabs[0]).toMatchObject({ title: "c", pinned: true });
    expect(ws.togglePin("#/knowledge/c")).toBe(false);
    expect(ws.store.get().tabs.every((t) => !t.pinned)).toBe(true);
    expect(ws.togglePin("#/knowledge/missing")).toBe(false);
  });
  it("close-others and close-all keep pinned tabs", () => {
    const ws = new Workspace(new MemoryKV(), "s");
    open(ws, "a", "b", "c");
    ws.togglePin("#/knowledge/a");
    ws.closeOthers("#/knowledge/c");
    expect(ws.store.get().tabs.map((t) => t.title)).toEqual(["a", "c"]);
    ws.closeAll();
    expect(ws.store.get().tabs.map((t) => t.title)).toEqual(["a"]);
  });
  it("the tab limit evicts the oldest unpinned tab, never a pinned one", () => {
    const ws = new Workspace(new MemoryKV(), "s");
    open(ws, "first");
    ws.togglePin("#/knowledge/first");
    open(ws, ...Array.from({ length: 12 }, (_, i) => `n${i}`));
    const titles = ws.store.get().tabs.map((t) => t.title);
    expect(titles).toHaveLength(12);
    expect(titles[0]).toBe("first");
    expect(titles).not.toContain("n0");
  });
});

describe("graph colour modes and time-lapse", () => {
  it("colours notes by project when asked, and the same project always gets the same slot", () => {
    expect(colorKey(mem("a", undefined, { type: "fact", project_id: "prj_1" }))).toBe("type:fact");
    expect(colorKey(mem("a", undefined, { project_id: "prj_1" }), "project")).toBe("proj:prj_1");
    expect(colorKey(mem("a"), "project")).toBe("proj:none");
    expect(colorKey({ ...mem("t"), kind: "tag" }, "project")).toBe("tag");
    expect(projectSlot("prj_1", 8)).toBe(projectSlot("prj_1", 8));
    expect(projectSlot("prj_1", 8)).toBeGreaterThanOrEqual(0);
    expect(projectSlot("prj_1", 8)).toBeLessThan(8);
  });
  const data: GraphData = {
    nodes: [mem("old", "2026-01-01T00:00:00+00:00"), mem("mid", "2026-02-01T00:00:00+00:00"), mem("new", "2026-03-01T00:00:00+00:00"), mem("undated"),
      { id: "project:p", kind: "project", label: "P", degree: 2 }, { id: "ghost:x", kind: "unresolved", label: "x", degree: 1 }, { id: "tag:t", kind: "tag", label: "#t", degree: 1 }],
    edges: [{ source: "mid", target: "project:p", kind: "scope" }, { source: "new", target: "project:p", kind: "scope" }, { source: "new", target: "ghost:x", kind: "link" }, { source: "old", target: "tag:t", kind: "tagged" }],
    truncated: false,
  };
  it("timeRange spans the dated notes and is null when none are dated", () => {
    expect(timeRange(data)).toEqual([Date.parse("2026-01-01T00:00:00+00:00"), Date.parse("2026-03-01T00:00:00+00:00")]);
    expect(timeRange({ nodes: [mem("u")], edges: [], truncated: false })).toBeNull();
  });
  it("notes appear when created; projects, tags and ghosts appear with their first visible neighbour", () => {
    const at = (iso: string) => [...visibleAt(data, Date.parse(iso))].sort();
    expect(at("2025-12-31T00:00:00+00:00")).toEqual(["undated"]);
    expect(at("2026-01-15T00:00:00+00:00")).toEqual(["old", "tag:t", "undated"]);
    expect(at("2026-02-15T00:00:00+00:00")).toEqual(["mid", "old", "project:p", "tag:t", "undated"]);
    expect(at("2026-03-02T00:00:00+00:00")).toEqual(["ghost:x", "mid", "new", "old", "project:p", "tag:t", "undated"]);
  });
});

describe("daily note", () => {
  afterEach(() => vi.unstubAllGlobals());
  const client = () => new AiosClient("", { mode: "bearer", token: "t" });
  const stub = (existing: { id: string; title: string }[]) => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input), "http://x");
      calls.push(`${init?.method ?? "GET"} ${u.pathname}${u.search}`);
      const body = (init?.method ?? "GET") === "POST" ? { id: "mem_new", title: JSON.parse(String(init!.body)).title } : { items: existing };
      return new Response(JSON.stringify(body), { status: init?.method === "POST" ? 201 : 200, headers: { "content-type": "application/json" } });
    }));
    return calls;
  };
  it("formats the local date as the title", () => {
    expect(dailyTitle(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(dailyTitle(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });
  it("opens today's note when it exists and creates it (tagged daily) when it does not", async () => {
    const d = new Date(2026, 5, 7);
    let calls = stub([{ id: "mem_old", title: "2026-06-06" }, { id: "mem_today", title: "2026-06-07" }]);
    expect(await ensureDailyNote(client(), d)).toBe("mem_today");
    expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
    calls = stub([{ id: "mem_old", title: "2026-06-06" }]);
    expect(await ensureDailyNote(client(), d)).toBe("mem_new");
    expect(calls.filter((c) => c.startsWith("POST"))).toHaveLength(1);
  });
  it("a double trigger shares one request, so only one note is created", async () => {
    const calls = stub([]);
    const [a, b] = await Promise.all([ensureDailyNote(client(), new Date(2026, 5, 7)), ensureDailyNote(client(), new Date(2026, 5, 7))]);
    expect(a).toBe(b);
    expect(calls.filter((c) => c.startsWith("POST"))).toHaveLength(1);
  });
});
