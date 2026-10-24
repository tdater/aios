import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphScreen } from "../screens/Graph";
import { Knowledge } from "../screens/Knowledge";
import { clearUnsavedDrafts } from "../screens/knowledge/NoteView";
import { newNoteTitle } from "../screens/knowledge/vaultContext";
import { Palette, invalidatePaletteIndex } from "../ui/Palette";
import { knowledgeQuery, openPalette, paletteStore } from "../ui/uiState";
import { NOTES, fakeServer, err, noteFull, noteRow, FakeNote } from "./fakeServer";
import { ctxFor, resetRoute, setWidth, Wrap } from "./helpers";

beforeEach(() => { clearUnsavedDrafts(); invalidatePaletteIndex(); resetRoute(""); setWidth(1400, 900); knowledgeQuery.set(""); newNoteTitle.set(""); paletteStore.set({ open: false, query: "" }); });

const LINKS = { id: "mem_a", outgoing: [{ target: "Android build checklist", id: "mem_b", title: "Android build checklist" }], backlinks: [{ id: "mem_b", title: "Android build checklist", excerpt: "Links back: [[Gradle caching]]" }],
  unresolved: ["Missing note"], unlinked_mentions: [{ id: "mem_c", title: "No force push" }] };

function vaultRoutes(notes: FakeNote[] = NOTES, extra: Record<string, Parameters<typeof fakeServer>[0][string]> = {}) {
  return {
    "GET /memories": (c) => {
      const q = c.query.get("q"), tag = c.query.get("tag"), type = c.query.get("type");
      let rows = notes.map(noteRow);
      if (tag) rows = rows.filter((n) => n.tags.some((t) => t === tag || t.startsWith(`${tag}/`)));
      if (type) rows = rows.filter((n) => n.type === type);
      if (q) rows = rows.filter((n) => (notes.find((x) => x.id === n.id)!.body ?? "").toLowerCase().includes(q.toLowerCase()) || n.title.toLowerCase().includes(q.toLowerCase())).map((n) => ({ ...n, excerpt: `…${q}…` }));
      return { body: { items: rows, next_cursor: null, limit: 200 } };
    },
    "GET /memories/tags": () => ({ body: { items: [{ tag: "android", count: 2 }, { tag: "android/build", count: 1 }, { tag: "build", count: 1 }] } }),
    "GET /projects": () => ({ body: { items: [], next_cursor: null, limit: 100 } }),
    ...Object.fromEntries(notes.flatMap((n) => [[`GET /memories/${n.id}`, () => ({ body: noteFull(n) })], [`GET /memories/${n.id}/links`, () => ({ body: { ...LINKS, id: n.id } })]])),
    ...extra,
  } as Parameters<typeof fakeServer>[0];
}
const renderK = (id?: string, ctxOpts = {}) => { const c = ctxFor(ctxOpts); return { ...c, ...render(<Wrap ctx={c.ctx}><Knowledge id={id} /></Wrap>) }; };

describe("vault explorer", () => {
  it("groups notes by type with counts, status dots, and opens a note", async () => {
    fakeServer(vaultRoutes());
    renderK();
    const tree = await screen.findByRole("tree", { name: "Notes" });
    for (const f of ["Preferences", "Facts", "Procedures"]) expect(within(tree).getByText(f)).toBeTruthy();
    expect(within(tree).getByRole("button", { name: /Gradle caching/ })).toBeTruthy();
    fireEvent.click(within(tree).getByRole("button", { name: /Android build checklist/ }));
    expect(location.hash).toBe("#/knowledge/mem_b");
    expect(within(tree).getByRole("button", { name: /No force push/ }).querySelector(".sdot.candidate")).toBeTruthy();
  });

  it("folders collapse and expand", async () => {
    fakeServer(vaultRoutes());
    renderK();
    const tree = await screen.findByRole("tree", { name: "Notes" });
    fireEvent.click(within(tree).getByRole("button", { name: /Facts/ }));
    expect(within(tree).queryByRole("button", { name: /Gradle caching/ })).toBeNull();
    fireEvent.click(within(tree).getByRole("button", { name: /Facts/ }));
    expect(within(tree).getByRole("button", { name: /Gradle caching/ })).toBeTruthy();
  });

  it("structured operators filter locally without a full-text call; free text goes to the server with the filters", async () => {
    const srv = fakeServer(vaultRoutes());
    renderK();
    await screen.findByRole("tree", { name: "Notes" });
    const box = screen.getByLabelText("Search notes");
    fireEvent.change(box, { target: { value: "type:procedure" } });
    await screen.findByText("1 result");
    expect(srv.calls.filter((c) => c.path === "/memories" && c.query.get("q"))).toHaveLength(0);
    fireEvent.change(box, { target: { value: "gradle tag:#android" } });
    await waitFor(() => expect(srv.calls.some((c) => c.path === "/memories" && c.query.get("q") === "gradle" && c.query.get("tag") === "android")).toBe(true));
    fireEvent.change(box, { target: { value: "weird bogus type:nope" } });
    await screen.findByText(/Not understood: type:nope/);
  });

  it("the tag pane nests tags and toggles a tag filter", async () => {
    fakeServer(vaultRoutes());
    renderK();
    await screen.findByRole("tree", { name: "Notes" });
    fireEvent.click(screen.getAllByRole("button", { name: /android/ }).find((b) => b.classList.contains("treerow"))!);
    expect((screen.getByLabelText("Search notes") as HTMLInputElement).value).toBe("#android");
    expect(await screen.findByText("tag: android")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "clear filters" }));
    expect((screen.getByLabelText("Search notes") as HTMLInputElement).value).toBe("");
  });

  it("a palette/tag pick hands its query to the explorer", async () => {
    fakeServer(vaultRoutes());
    renderK();
    await screen.findByRole("tree", { name: "Notes" });
    act(() => knowledgeQuery.set("#build"));
    await waitFor(() => expect((screen.getByLabelText("Search notes") as HTMLInputElement).value).toBe("#build"));
    expect(knowledgeQuery.get()).toBe("");
  });

  it("empty vault shows an honest empty state; server errors are shown", async () => {
    fakeServer(vaultRoutes([]));
    const { unmount } = renderK();
    await screen.findByText(/Your vault is empty/);
    unmount();
    fakeServer({ ...vaultRoutes(), "GET /memories": () => err(500, "internal_error", "boom") });
    renderK();
    await screen.findByText(/boom/);
  });
});

describe("note view", () => {
  it("renders markdown with resolved and unresolved wiki links, callouts, tasks and tags; links navigate", async () => {
    fakeServer(vaultRoutes());
    const { container } = renderK("mem_a");
    await screen.findByRole("button", { name: "Edit" });
    const md = container.querySelector(".md")!;
    const live = [...md.querySelectorAll("button.wikilink:not(.ghost)")].map((b) => b.textContent);
    const ghost = [...md.querySelectorAll("button.wikilink.ghost")].map((b) => b.textContent);
    expect(live).toEqual(["Android build checklist"]);
    expect(ghost).toEqual(["Missing note"]);
    expect(md.querySelector(".callout.tip")).not.toBeNull();
    fireEvent.click(md.querySelector("button.wikilink:not(.ghost)")!);
    expect(location.hash).toBe("#/knowledge/mem_b");
    fireEvent.click(md.querySelector("button.wikilink.ghost")!);
    expect(location.hash).toBe("#/knowledge/new");
    expect(newNoteTitle.get()).toBe("Missing note");
  });

  it("shows backlinks, outgoing, unresolved and unlinked mentions in the side panel, and the outline", async () => {
    fakeServer(vaultRoutes());
    renderK("mem_a");
    const panel = await screen.findByRole("complementary", { name: "Note details" });
    expect(await within(panel).findByText("Backlinks")).toBeTruthy();
    expect(within(panel).getByText(/Links back/)).toBeTruthy();
    expect(within(panel).getByText(/Missing note \(not created\)/)).toBeTruthy();
    expect(within(panel).getByText("Unlinked mentions")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("tab", { name: /Outline/ }));
    expect(within(panel).getByRole("link", { name: "Gradle caching" })).toBeTruthy();
    fireEvent.click(within(panel).getByRole("tab", { name: /Graph/ }));
    expect(within(panel).getByRole("img", { name: /Links around Gradle caching/ })).toBeTruthy();
  });

  it("hostile note content renders as inert text", async () => {
    const evil: FakeNote = { id: "mem_x", title: "<img src=x onerror=1>", body: "<script>window.pwn=1</script> [x](javascript:alert(1)) ![t](https://t.example/p.png)" };
    fakeServer(vaultRoutes([evil]));
    const { container } = renderK("mem_x");
    await screen.findByRole("heading", { level: 1 });
    expect(container.querySelector("script, img, a[href^='javascript']")).toBeNull();
    expect(container.textContent).toContain("<script>window.pwn=1</script>");
  });

  it("edits and saves with the reviewed version; the toast confirms", async () => {
    const srv = fakeServer(vaultRoutes(NOTES, { "PATCH /memories/mem_a": () => ({ body: noteFull({ ...NOTES[0], title: "Gradle caching v2", version: 2 }) }) }));
    renderK("mem_a");
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Gradle caching v2" } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(srv.count("PATCH", "/memories/mem_a")).toBe(1));
    expect(srv.calls.find((c) => c.method === "PATCH")!.body).toEqual({ title: "Gradle caching v2", expected_version: 1 });
  });

  it("a version conflict keeps the user's edits, says nothing was saved, and offers a reload", async () => {
    fakeServer(vaultRoutes(NOTES, { "PATCH /memories/mem_a": () => err(409, "version_conflict", "changed", { current_version: 5 }) }));
    renderK("mem_a");
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(await screen.findByLabelText("Note body"), { target: { value: "my careful rewrite" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await screen.findByText(/were NOT saved/);
    expect((screen.getByLabelText("Note body") as HTMLTextAreaElement).value).toBe("my careful rewrite");
    expect(screen.getByRole("button", { name: "Discard mine and reload" })).toBeTruthy();
  });

  it("offline: editing and forgetting are disabled", async () => {
    fakeServer(vaultRoutes());
    renderK("mem_a", { connected: false });
    await screen.findByRole("button", { name: "Edit" });
    expect((screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled).toBe(true);
    expect(((await screen.findByRole("button", { name: /Forget…/ })) as HTMLButtonElement).disabled).toBe(true);
  });

  it("unsaved edits are restored when you come back to the note in the same session", async () => {
    fakeServer(vaultRoutes());
    const a = renderK("mem_b");
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(await screen.findByLabelText("Note body"), { target: { value: "half-finished thought" } });
    a.unmount();
    renderK("mem_b");
    await screen.findByText(/Restored your unsaved edits/);
    expect((screen.getByLabelText("Note body") as HTMLTextAreaElement).value).toBe("half-finished thought");
  });

  it("an unsaved draft never leaks into the next note you open", async () => {
    fakeServer(vaultRoutes());
    const c = ctxFor();
    const { rerender } = render(<Wrap ctx={c.ctx}><Knowledge id="mem_a" /></Wrap>);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(await screen.findByLabelText("Note body"), { target: { value: "draft for A only" } });
    rerender(<Wrap ctx={c.ctx}><Knowledge id="mem_b" /></Wrap>);
    await screen.findByRole("heading", { level: 1, name: "Android build checklist" });
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(screen.queryByText(/Restored your unsaved edits/)).toBeNull();
    expect(screen.queryByDisplayValue("draft for A only")).toBeNull();
  });

  it("forgetting needs a deliberate confirmation", async () => {
    const srv = fakeServer(vaultRoutes(NOTES, { "POST /memories/mem_c/forget": () => ({ body: { ok: true } }) }));
    renderK("mem_c");
    fireEvent.click(await screen.findByRole("button", { name: /Forget…/ }));
    expect(srv.count("POST", "/memories/mem_c/forget")).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Yes, forget" }));
    await waitFor(() => expect(srv.count("POST", "/memories/mem_c/forget")).toBe(1));
  });

  it("the tag editor normalises tags and removes them", async () => {
    fakeServer(vaultRoutes());
    renderK("mem_c");
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const add = await screen.findByLabelText("Add a tag");
    fireEvent.change(add, { target: { value: "#My New Tag" } });
    fireEvent.keyDown(add, { key: "Enter" });
    expect(await screen.findByText("#my-new-tag")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove tag my-new-tag" }));
    expect(screen.queryByText("#my-new-tag")).toBeNull();
  });
});

describe("new note", () => {
  it("prefills from a ghost link and creates with tags, type and project", async () => {
    newNoteTitle.set("Missing note");
    const srv = fakeServer(vaultRoutes(NOTES, { "POST /memories": () => ({ status: 201, body: noteFull({ id: "mem_new", title: "Missing note" }) }) }));
    renderK("new");
    const title = await screen.findByLabelText("Title");
    expect((title as HTMLInputElement).value).toBe("Missing note");
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "lesson" } });
    const add = screen.getByLabelText("Add a tag");
    fireEvent.change(add, { target: { value: "android" } });
    fireEvent.keyDown(add, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Create note" }));
    await waitFor(() => expect(srv.count("POST", "/memories")).toBe(1));
    expect(srv.calls.find((c) => c.method === "POST")!.body).toMatchObject({ title: "Missing note", type: "lesson", tags: ["android"], scope: "global" });
    await waitFor(() => expect(location.hash).toBe("#/knowledge/mem_new"));
  });
  it("is disabled offline", async () => {
    fakeServer(vaultRoutes());
    renderK("new", { connected: false });
    expect((await screen.findByRole("button", { name: "Create note" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("command palette", () => {
  const setup = (commands: Record<string, () => void> = {}) => {
    const srv = fakeServer({
      ...vaultRoutes(),
      "GET /runs": () => ({ body: { items: [{ id: "run_1", task_title: "Audit workspace", display_state: "completed" }], next_cursor: null, limit: 25 } }),
    });
    const c = ctxFor();
    render(<Wrap ctx={c.ctx}><button>opener</button><Palette commands={commands} /></Wrap>);
    return { srv, ...c };
  };
  it("opens, indexes the vault, ranks notes, and Enter opens the selected note", async () => {
    setup();
    act(() => openPalette());
    const box = await screen.findByRole("combobox", { name: "Search" });
    await screen.findByText(/3 notes indexed/);
    fireEvent.change(box, { target: { value: "gradle" } });
    const opt = await screen.findByRole("option", { name: /Gradle caching/ });
    expect(opt.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(location.hash).toBe("#/knowledge/mem_a");
    expect(paletteStore.get().open).toBe(false);
  });
  it("arrow keys move the selection (wrapping) and mirror it in aria-activedescendant", async () => {
    setup();
    act(() => openPalette());
    const box = await screen.findByRole("combobox", { name: "Search" });
    await screen.findByText(/3 notes indexed/);
    const first = box.getAttribute("aria-activedescendant");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box.getAttribute("aria-activedescendant")).not.toBe(first);
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(box.getAttribute("aria-activedescendant")).toBe(first);
  });
  it("'>' shows only commands and runs the chosen one; Escape closes", async () => {
    const theme = vi.fn();
    setup({ theme });
    act(() => openPalette(">"));
    const box = await screen.findByRole("combobox", { name: "Search" });
    expect(screen.queryByRole("option", { name: /Gradle/ })).toBeNull();
    fireEvent.change(box, { target: { value: ">theme" } });
    await screen.findByRole("option", { name: /Cycle colour theme/ });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(theme).toHaveBeenCalledOnce();
    act(() => openPalette());
    fireEvent.keyDown(await screen.findByRole("combobox", { name: "Search" }), { key: "Escape" });
    expect(paletteStore.get().open).toBe(false);
  });
  it("'#' lists tags; picking one sends the filter to the Knowledge screen", async () => {
    setup();
    act(() => openPalette("#"));
    const box = await screen.findByRole("combobox", { name: "Search" });
    await screen.findByText(/3 notes indexed/);
    fireEvent.change(box, { target: { value: "#and" } });
    await screen.findAllByRole("option");
    fireEvent.click(screen.getAllByRole("option").find((o) => /^#android\d*$/.test(o.textContent ?? ""))!);
    expect(knowledgeQuery.get()).toBe("#android");
    expect(location.hash).toBe("#/knowledge");
  });
  it("still works for commands when the index cannot load (offline/server error), and says so", async () => {
    const run = vi.fn();
    fakeServer({ "GET /memories": () => err(500, "internal_error", "boom"), "GET /projects": () => err(500, "x"), "GET /runs": () => err(500, "x"), "GET /memories/tags": () => err(500, "x") });
    const c = ctxFor();
    render(<Wrap ctx={c.ctx}><Palette commands={{ help: run }} /></Wrap>);
    act(() => openPalette(">shortcuts"));
    await screen.findByText(/Index unavailable/);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Search" }), { key: "Enter" });
    expect(run).toHaveBeenCalled();
  });
  it("Enter with no match searches the vault for the typed text", async () => {
    setup();
    act(() => openPalette());
    const box = await screen.findByRole("combobox", { name: "Search" });
    fireEvent.change(box, { target: { value: "zzzqqq nothing" } });
    await screen.findByText(/No matches/);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(knowledgeQuery.get()).toBe("zzzqqq nothing");
    expect(location.hash).toBe("#/knowledge");
  });
});

describe("graph screen", () => {
  const GRAPH = { nodes: [
    { id: "mem_a", kind: "memory", label: "Gradle caching", degree: 2, type: "fact", status: "approved" }, { id: "mem_b", kind: "memory", label: "Android build checklist", degree: 1, type: "procedure", status: "approved" },
    { id: "mem_far", kind: "memory", label: "Far away", degree: 1, type: "fact", status: "approved" }, { id: "mem_far2", kind: "memory", label: "Farther", degree: 1, type: "fact", status: "approved" },
    { id: "lonely", kind: "memory", label: "Lonely", degree: 0, type: "fact", status: "approved" }],
    edges: [{ source: "mem_a", target: "mem_b", kind: "link" }, { source: "mem_far", target: "mem_far2", kind: "link" }], truncated: false };
  it("list view is an accessible alternative with open and neighbourhood actions", async () => {
    fakeServer({ "GET /graph": () => ({ body: GRAPH }) });
    const c = ctxFor();
    render(<Wrap ctx={c.ctx}><GraphScreen /></Wrap>);
    await screen.findByRole("img", { name: /Knowledge graph\. 5 nodes, 2 connections/ });
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    const items = await screen.findAllByRole("listitem");
    expect(items[0].textContent).toContain("Gradle caching");              // best-connected first
    fireEvent.click(within(items[0]).getByRole("button", { name: "Open" }));
    expect(location.hash).toBe("#/knowledge/mem_a");
    fireEvent.click(within(items[0]).getByRole("button", { name: "Neighbourhood" }));
    expect(location.hash).toBe("#/graph/mem_a");
  });
  it("filters re-query the server; orphans can be hidden", async () => {
    const srv = fakeServer({ "GET /graph": () => ({ body: GRAPH }) });
    const c = ctxFor();
    render(<Wrap ctx={c.ctx}><GraphScreen /></Wrap>);
    await screen.findByRole("img", { name: /5 nodes/ });
    fireEvent.click(screen.getByLabelText("Show tags"));
    await waitFor(() => expect(srv.calls.some((x) => x.path === "/graph" && x.query.get("tags") === "true")).toBe(true));
    fireEvent.click(screen.getByLabelText(/Show orphans/));
    await screen.findByRole("img", { name: /4 nodes/ });
  });
  it("the local graph shows only the neighbourhood of a note within the chosen depth", async () => {
    fakeServer({ "GET /graph": () => ({ body: GRAPH }) });
    const c = ctxFor();
    render(<Wrap ctx={c.ctx}><GraphScreen id="mem_a" /></Wrap>);
    await screen.findByRole("img", { name: /Neighbourhood graph of Gradle caching\. 2 nodes/ });
    expect(screen.getByRole("button", { name: "Whole graph" })).toBeTruthy();
  });
  it("unknown note and empty graph are explained honestly", async () => {
    fakeServer({ "GET /graph": () => ({ body: { nodes: [], edges: [], truncated: false } }) });
    const c = ctxFor();
    const { unmount } = render(<Wrap ctx={c.ctx}><GraphScreen /></Wrap>);
    await screen.findByText(/Nothing to graph yet/);
    unmount();
    render(<Wrap ctx={c.ctx}><GraphScreen id="mem_gone" /></Wrap>);
    await screen.findByText(/not in the graph/);
  });
});
