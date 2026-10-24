import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphScreen } from "../screens/Graph";
import { Knowledge } from "../screens/Knowledge";
import { clearUnsavedDrafts } from "../screens/knowledge/NoteView";
import { Palette, invalidatePaletteIndex } from "../ui/Palette";
import { TabStrip } from "../ui/Chrome";
import { openPalette, paletteStore } from "../ui/uiState";
import { NOTES, fakeServer, noteFull, noteRow } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

beforeEach(() => { clearUnsavedDrafts(); invalidatePaletteIndex(); resetRoute(""); setWidth(1400, 900); paletteStore.set({ open: false, query: "" }); });

const GRAPH = { nodes: [
  { id: "mem_a", kind: "memory", label: "Alpha", degree: 2, type: "fact", status: "approved", project_id: "prj_1", created_at: "2026-01-01T00:00:00+00:00" },
  { id: "mem_b", kind: "memory", label: "Beta", degree: 1, type: "procedure", status: "approved", project_id: null, created_at: "2026-02-01T00:00:00+00:00" },
  { id: "mem_c", kind: "memory", label: "Gamma", degree: 1, type: "fact", status: "approved", project_id: "prj_1", created_at: "2026-03-01T00:00:00+00:00" },
  { id: "project:prj_1", kind: "project", label: "Apollo", degree: 2 }],
  edges: [{ source: "mem_a", target: "mem_b", kind: "link" }, { source: "mem_a", target: "project:prj_1", kind: "scope" }, { source: "mem_c", target: "project:prj_1", kind: "scope" }], truncated: false };

/** Real accessibility rules run in jsdom. Colour contrast needs real layout/paint, so that rule is checked by eye in screenshots instead. */
async function violations(node: Element) {
  const r = await axe.run(node, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return r.violations.map((v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

describe("pinned tabs in the tab strip", () => {
  it("a pinned tab shows a pin, cannot be closed from the keyboard, and double-click / Alt+P toggle it", () => {
    const c = ctxFor();
    c.ctx.workspace.visit({ tab: "knowledge", id: "mem_a" }, "Alpha");
    c.ctx.workspace.visit({ tab: "knowledge", id: "mem_b" }, "Beta");
    render(<Wrap ctx={c.ctx}><TabStrip /></Wrap>);
    const alpha = () => screen.getByRole("tab", { name: /Alpha/ });
    fireEvent.doubleClick(alpha());
    expect(c.ctx.workspace.store.get().tabs[0]).toMatchObject({ title: "Alpha", pinned: true });
    expect(alpha().parentElement!.className).toContain("pinned");
    expect(alpha().title).toMatch(/pinned/);
    fireEvent.keyDown(alpha(), { key: "Delete" });
    expect(c.ctx.workspace.store.get().tabs.map((t) => t.title)).toEqual(["Alpha", "Beta"]);       // refused
    fireEvent.keyDown(screen.getByRole("tab", { name: /Beta/ }), { key: "Delete" });
    expect(c.ctx.workspace.store.get().tabs.map((t) => t.title)).toEqual(["Alpha"]);                // an unpinned tab closes
    fireEvent.keyDown(alpha(), { key: "p", altKey: true });
    expect(c.ctx.workspace.store.get().tabs[0].pinned).toBeUndefined();
  });
});

describe("graph: colour by project and time-lapse", () => {
  const setup = async () => {
    fakeServer({ "GET /graph": () => ({ body: GRAPH }) });
    const c = ctxFor();
    const r = render(<Wrap ctx={c.ctx}><GraphScreen /></Wrap>);
    await screen.findByRole("img", { name: /Knowledge graph/ });
    return r;
  };
  const bar = () => screen.getByRole("group", { name: "Time-lapse of the vault" }).textContent ?? "";
  it("the legend switches from note types to projects", async () => {
    const { container } = await setup();
    const legend = () => container.querySelector(".graphlegend")!.textContent ?? "";
    expect(legend()).toContain("Procedure");
    fireEvent.change(screen.getByLabelText("Colour notes by"), { target: { value: "project" } });
    expect(legend()).toContain("Apollo");
    expect(legend()).toContain("No project");
    expect(legend()).not.toContain("Procedure");
  });
  it("the slider rewinds the vault and shows everything again at the end", async () => {
    await setup();
    const slider = screen.getByLabelText("Show the vault as of") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: String(Date.parse("2026-02-10T00:00:00+00:00")) } });
    expect(bar()).toMatch(/2 notes/);
    fireEvent.change(slider, { target: { value: slider.min } });
    expect(bar()).toMatch(/1 notes/);
    fireEvent.change(slider, { target: { value: slider.max } });
    expect(bar()).not.toMatch(/ notes ·/);
  });
  it("play steps forward by itself and stops at the present", async () => {
    await setup();
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Play time-lapse" }));
      expect(screen.getByRole("button", { name: "Pause time-lapse" })).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
      expect(screen.getByRole("button", { name: "Play time-lapse" })).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });
});

describe("accessibility (axe rules in jsdom)", () => {
  const routes = () => ({
    "GET /memories": () => ({ body: { items: NOTES.map(noteRow), next_cursor: null, limit: 200 } }),
    "GET /memories/tags": () => ({ body: { items: [{ tag: "android", count: 2 }] } }),
    "GET /projects": () => ({ body: { items: [], next_cursor: null, limit: 100 } }),
    "GET /runs": () => ({ body: { items: [], next_cursor: null, limit: 25 } }),
    "GET /graph": () => ({ body: GRAPH }),
    ...Object.fromEntries(NOTES.flatMap((n) => [[`GET /memories/${n.id}`, () => ({ body: noteFull(n) })], [`GET /memories/${n.id}/links`, () => ({ body: { id: n.id, outgoing: [], backlinks: [], unresolved: [], unlinked_mentions: [] } })]])),
  });
  it("the explorer and a note view have no violations", async () => {
    fakeServer(routes());
    const c = ctxFor();
    const { container } = render(<Wrap ctx={c.ctx}><Knowledge id="mem_a" /></Wrap>);
    await screen.findByRole("button", { name: "Edit" });
    await screen.findByRole("tree", { name: "Notes" });
    expect(await violations(container)).toEqual([]);
  });
  it("the command palette has no violations", async () => {
    fakeServer(routes());
    const c = ctxFor();
    const { baseElement } = render(<Wrap ctx={c.ctx}><Palette commands={{}} /></Wrap>);
    act(() => openPalette());
    await screen.findByText(/3 notes indexed/);
    expect(await violations(baseElement)).toEqual([]);
  });
  it("the graph screen (graph and list views) has no violations", async () => {
    fakeServer(routes());
    const c = ctxFor();
    const { container } = render(<Wrap ctx={c.ctx}><GraphScreen /></Wrap>);
    await screen.findByRole("img", { name: /Knowledge graph/ });
    expect(await violations(container)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    await screen.findAllByRole("listitem");
    expect(await violations(container)).toEqual([]);
  });
  it("the tab strip has no violations", async () => {
    const c = ctxFor();
    c.ctx.workspace.visit({ tab: "knowledge", id: "mem_a" }, "Alpha");
    c.ctx.workspace.visit({ tab: "graph" });
    const { container } = render(<Wrap ctx={c.ctx}><TabStrip /></Wrap>);
    await waitFor(() => screen.getByRole("tab", { name: /Alpha/ }));
    expect(await violations(container)).toEqual([]);
  });
});
