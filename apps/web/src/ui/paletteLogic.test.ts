import { describe, expect, it } from "vitest";
import { PItem, flatten, paletteResults } from "./paletteLogic";

const items: PItem[] = [
  { id: "n1", group: "Notes", label: "Gradle caching", icon: "file", keywords: "build speed #android", action: { type: "route", route: { tab: "knowledge", id: "mem_1" } } },
  { id: "n2", group: "Notes", label: "Android build checklist", icon: "file", action: { type: "route", route: { tab: "knowledge", id: "mem_2" } } },
  { id: "p1", group: "Projects", label: "Android companion app", icon: "folder", action: { type: "route", route: { tab: "projects", id: "prj_1" } } },
  { id: "r1", group: "Runs", label: "Audit workspace", icon: "play", action: { type: "route", route: { tab: "runs", id: "run_1" } } },
  { id: "t1", group: "Tags", label: "#android", icon: "tag", action: { type: "tag", tag: "android" } },
  { id: "g1", group: "Go to", label: "Graph view", icon: "graph", action: { type: "route", route: { tab: "graph" } } },
  { id: "c1", group: "Commands", label: "Toggle theme", icon: "moon", action: { type: "command", id: "theme" } },
  { id: "c2", group: "Commands", label: "Show keyboard shortcuts", icon: "keyboard", action: { type: "command", id: "help" } },
  { id: "o1", group: "Open tabs", label: "Gradle caching", icon: "file", action: { type: "route", route: { tab: "knowledge", id: "mem_1" } } },
];
const labels = (q: string) => flatten(paletteResults(q, items)).map((i) => i.id);

describe("palette results", () => {
  it("empty query shows starting points only (tabs, destinations, a few commands), never giant note lists", () => {
    const g = paletteResults("", items);
    expect(g.map((x) => x.group)).toEqual(["Open tabs", "Go to", "Commands"]);
  });
  it("searches across groups in a stable order and ranks the best match first within a group", () => {
    const g = paletteResults("android", items);
    expect(g.map((x) => x.group)).toEqual(["Notes", "Projects"]);          // Tags excluded without '#'
    expect(g[0].entries[0].item.id).toMatch(/n[12]/);
    expect(labels("android")).toContain("p1");
  });
  it("keywords make notes findable without showing in the label (and highlights stay inside the label)", () => {
    const r = paletteResults("speed", items);
    expect(r[0].entries[0].item.id).toBe("n1");
    expect(r[0].entries[0].indices.every((i) => i < "Gradle caching".length)).toBe(true);
  });
  it("prefix modes: '>' commands, '#' tags, '/' notes", () => {
    expect(labels(">")).toEqual(["c1", "c2"]);
    expect(labels(">theme")).toEqual(["c1"]);
    expect(labels("#and")).toEqual(["t1"]);
    expect(labels("/gradle")).toEqual(["n1"]);
    expect(labels("/")).toEqual(["n1", "n2"]);
  });
  it("returns nothing for gibberish and limits each group", () => {
    expect(paletteResults("zzzqqq", items)).toEqual([]);
    const many: PItem[] = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, group: "Notes", label: `Note ${i}`, icon: "file", action: { type: "command", id: "x" } }));
    expect(paletteResults("note", many, 5)[0].entries).toHaveLength(5);
  });
});
