import { describe, expect, it } from "vitest";
import { NoteRow, buildTagTree, buildTree, filterNotes, resolveWiki, titleIndex } from "./vault";

const n = (id: string, title: string, over: Partial<NoteRow> = {}): NoteRow => ({ id, title, type: "fact", status: "approved", scope: "global", confidence: 0.5, version: 1, tags: [], created_at: `2026-01-0${id.length}`, ...over });

describe("explorer tree", () => {
  const notes = [n("a", "zeta", { type: "lesson" }), n("b", "Alpha", { type: "fact" }), n("c", "beta", { type: "fact", status: "candidate" }), n("d", "Gamma", { type: "preference", project_id: "p1", scope: "project" })];
  it("groups by type in a fixed, friendly order with case-insensitive sorted notes", () => {
    const t = buildTree(notes, "type");
    expect(t.map((f) => f.label)).toEqual(["Preferences", "Facts", "Lessons"]);
    expect(t[1].notes.map((x) => x.title)).toEqual(["Alpha", "beta"]);
  });
  it("groups by status (approved first) and by project with names", () => {
    expect(buildTree(notes, "status").map((f) => f.key)).toEqual(["approved", "candidate"]);
    const p = buildTree(notes, "project", (id) => (id === "p1" ? "Android app" : "?"));
    expect(p.map((f) => f.label)).toEqual(["Android app", "Global (no project)"]);
  });
});

describe("tag tree", () => {
  it("nests a/b under a and rolls counts up, biggest first", () => {
    const t = buildTagTree([{ tag: "android", count: 2 }, { tag: "android/build", count: 3 }, { tag: "android/test", count: 1 }, { tag: "api", count: 5 }]);
    expect(t.map((x) => [x.full, x.count])).toEqual([["android", 6], ["api", 5]]);
    expect(t[0].children.map((x) => x.full)).toEqual(["android/build", "android/test"]);
  });
  it("handles empty input and stray slashes", () => {
    expect(buildTagTree([])).toEqual([]);
    expect(buildTagTree([{ tag: "/x//y/", count: 1 }])[0].children[0].full).toBe("x/y");
  });
});

describe("wiki link resolution", () => {
  it("resolves by id or case-insensitive title; oldest note wins duplicate titles", () => {
    const idx = titleIndex([n("new", "Same", { created_at: "2026-02-01" }), n("old", "Same", { created_at: "2026-01-01" }), n("x", "Other")]);
    expect(resolveWiki("same", idx)).toBe("old");
    expect(resolveWiki("SAME", idx)).toBe("old");
    expect(resolveWiki("new", idx)).toBe("new");
    expect(resolveWiki("Other", idx)).toBe("x");
    expect(resolveWiki("missing", idx)).toBeNull();
  });
});

describe("structured filters", () => {
  const notes = [n("a", "A", { tags: ["android/build"], type: "lesson" }), n("b", "B", { tags: ["api"], scope: "project" }), n("c", "C", { status: "candidate" })];
  it("filters by tag (including nested children), type, scope and status", () => {
    expect(filterNotes(notes, { tag: "android" }).map((x) => x.id)).toEqual(["a"]);
    expect(filterNotes(notes, { tag: "android/build" }).map((x) => x.id)).toEqual(["a"]);
    expect(filterNotes(notes, { type: "lesson" }).map((x) => x.id)).toEqual(["a"]);
    expect(filterNotes(notes, { scope: "project" }).map((x) => x.id)).toEqual(["b"]);
    expect(filterNotes(notes, { status: "candidate" }).map((x) => x.id)).toEqual(["c"]);
    expect(filterNotes(notes, {}).length).toBe(3);
  });
});
