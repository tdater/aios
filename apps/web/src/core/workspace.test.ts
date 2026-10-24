import { describe, expect, it } from "vitest";
import { matchCombo } from "../ui/hotkeys";
import { Workspace, defaultTitle, hrefFor, isDocumentRoute } from "./workspace";
import { MemoryKV } from "./storage";

describe("workspace tabs", () => {
  it("only documents (detail routes and the graph) become tabs; revisiting focuses instead of duplicating", () => {
    const ws = new Workspace(new MemoryKV(), "srv");
    ws.visit({ tab: "runs" });
    ws.visit({ tab: "home" });
    expect(ws.store.get().tabs).toEqual([]);
    ws.visit({ tab: "knowledge", id: "mem_abc123def" }, "Gradle caching");
    ws.visit({ tab: "knowledge", id: "mem_abc123def" });
    ws.visit({ tab: "runs", id: "run_0123456789" });
    ws.visit({ tab: "graph" });
    expect(ws.store.get().tabs.map((t) => t.title)).toEqual(["Gradle caching", "Run 01234567", "Graph view"]);
    expect(isDocumentRoute({ tab: "projects" })).toBe(false);
    expect(hrefFor({ tab: "inbox", sub: "approval", id: "apr_1" })).toBe("#/inbox/approval/apr_1");
    expect(defaultTitle({ tab: "inbox", sub: "approval", id: "apr_xyz" })).toBe("Review xyz");
  });

  it("updates titles and ignores empty ones", () => {
    const ws = new Workspace(new MemoryKV(), "srv");
    ws.visit({ tab: "knowledge", id: "mem_1" });
    const href = hrefFor({ tab: "knowledge", id: "mem_1" });
    ws.setTitle(href, "   ");
    expect(ws.store.get().tabs[0].title).toBe("Note 1");
    ws.setTitle(href, "A".repeat(200));
    expect(ws.store.get().tabs[0].title).toHaveLength(80);
  });

  it("closing returns the neighbouring tab, keeps the active one when closing another, and cycles", () => {
    const ws = new Workspace(new MemoryKV(), "srv");
    for (const id of ["mem_a", "mem_b", "mem_c"]) ws.visit({ tab: "knowledge", id });
    const [a, b, c] = ws.store.get().tabs.map((t) => t.href);
    expect(ws.close(b, b)).toBe(c);                    // closing the active middle tab shows the one that took its place
    expect(ws.close(c, a)).toBe(a);                    // closing a background tab leaves the active one alone
    expect(ws.close(a, a)).toBeNull();                 // nothing left
    ws.visit({ tab: "knowledge", id: "mem_x" });
    ws.visit({ tab: "knowledge", id: "mem_y" });
    const [x, y] = ws.store.get().tabs.map((t) => t.href);
    expect(ws.neighbour(x, 1)).toBe(y);
    expect(ws.neighbour(y, 1)).toBe(x);
    expect(ws.neighbour(x, -1)).toBe(y);
    ws.closeOthers(y);
    expect(ws.store.get().tabs.map((t) => t.href)).toEqual([y]);
    ws.closeAll();
    expect(ws.neighbour(y, 1)).toBeNull();
  });

  it("caps the number of tabs, persists per server partition and drops corrupt saved entries", () => {
    const kv = new MemoryKV();
    const ws = new Workspace(kv, "srvA");
    for (let i = 0; i < 20; i++) ws.visit({ tab: "runs", id: `run_${i}` });
    expect(ws.store.get().tabs).toHaveLength(12);
    expect(ws.store.get().tabs[11].href).toBe("#/runs/run_19");
    expect(new Workspace(kv, "srvA").store.get().tabs).toHaveLength(12);
    expect(new Workspace(kv, "srvB").store.get().tabs).toHaveLength(0);           // never another server's tabs
    kv.set("aios.workspace.v1.bad", JSON.stringify({ tabs: [{ href: "javascript:alert(1)", title: "x" }, { href: "#/ok/1", title: "fine" }, null, 5] }));
    expect(new Workspace(kv, "bad").store.get().tabs.map((t) => t.href)).toEqual(["#/ok/1"]);
  });
});

describe("hotkey matching", () => {
  const ev = (key: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
    ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });
  it("treats Ctrl and Cmd as mod, and is exact about modifiers", () => {
    expect(matchCombo(ev("k", { ctrlKey: true }), "mod+k")).toBe(true);
    expect(matchCombo(ev("K", { metaKey: true }), "mod+k")).toBe(true);
    expect(matchCombo(ev("k"), "mod+k")).toBe(false);
    expect(matchCombo(ev("k", { ctrlKey: true, altKey: true }), "mod+k")).toBe(false);
    expect(matchCombo(ev("w", { altKey: true }), "alt+w")).toBe(true);
    expect(matchCombo(ev("w", { altKey: true, shiftKey: true }), "alt+w")).toBe(false);
  });
  it("handles named and symbol keys", () => {
    expect(matchCombo(ev("Escape"), "escape")).toBe(true);
    expect(matchCombo(ev("?", { shiftKey: true }), "?")).toBe(true);
    expect(matchCombo(ev("/"), "/")).toBe(true);
    expect(matchCombo(ev("\\", { ctrlKey: true }), "mod+\\")).toBe(true);
    expect(matchCombo(ev("a"), "b")).toBe(false);
  });
});
