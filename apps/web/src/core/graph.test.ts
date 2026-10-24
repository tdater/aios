import { describe, expect, it } from "vitest";
import { Layout } from "./graphLayout";
import { colorKey, filterGraph, localGraphFromLinks, matchNodes, neighborhood } from "./graph";
import { GraphData, GraphNode } from "./types";

const node = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({ id, kind: "memory", label: id, degree: 0, ...over });
const data: GraphData = {
  nodes: [node("a", { degree: 2 }), node("b", { degree: 2 }), node("c", { degree: 1 }), node("d", { degree: 1 }), node("lonely", { degree: 0 }), node("tag:x", { kind: "tag", degree: 1 })],
  edges: [{ source: "a", target: "b", kind: "link" }, { source: "b", target: "c", kind: "link" }, { source: "c", target: "d", kind: "link" }, { source: "a", target: "tag:x", kind: "tagged" }],
  truncated: false,
};

describe("graph helpers", () => {
  it("neighbourhood: BFS by depth, undirected, with the edges among kept nodes", () => {
    expect(neighborhood(data, "a", 1).nodes.map((n) => n.id).sort()).toEqual(["a", "b", "tag:x"]);
    expect(neighborhood(data, "a", 2).nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c", "tag:x"]);
    expect(neighborhood(data, "d", 1).nodes.map((n) => n.id).sort()).toEqual(["c", "d"]);
    expect(neighborhood(data, "missing", 3).nodes).toEqual([]);
    expect(neighborhood(data, "a", 1).edges).toHaveLength(2);
  });
  it("filters orphans and node kinds, dropping dangling edges", () => {
    const f = filterGraph(data, { orphans: false, kinds: new Set(["memory"]) });
    expect(f.nodes.map((n) => n.id)).toEqual(["a", "b", "c", "d"]);
    expect(f.edges).toHaveLength(3);
    expect(filterGraph(data, { orphans: true, kinds: new Set(["memory", "tag"]) }).nodes).toHaveLength(6);
  });
  it("highlight matching is fuzzy and an empty box means no dimming", () => {
    expect(matchNodes(data.nodes, "")).toBeNull();
    expect([...matchNodes([node("Gradle caching"), node("Android build")], "gc")!]).toEqual(["Gradle caching"]);
  });
  it("builds the note's local graph from its link data without another request", () => {
    const g = localGraphFromLinks({ id: "n1", title: "Note" }, {
      id: "n1", outgoing: [{ target: "x", id: "n2", title: "Two" }], backlinks: [{ id: "n3", title: "Three", excerpt: "" }], unresolved: ["Ghost"], unlinked_mentions: [] });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["ghost:ghost", "n1", "n2", "n3"]);
    expect(g.nodes.find((n) => n.id === "n1")!.degree).toBe(3);
    expect(g.edges).toHaveLength(3);
  });
  it("colour keys: notes by type, others by kind", () => {
    expect(colorKey(node("x", { type: "lesson" }))).toBe("type:lesson");
    expect(colorKey(node("x", { kind: "tag" }))).toBe("tag");
  });
});

describe("force layout", () => {
  const ns = data.nodes.map((n) => ({ id: n.id, degree: n.degree }));
  it("is deterministic: same graph and seed give identical positions", () => {
    const a = new Layout(ns, data.edges, { seed: 3 }); a.settle();
    const b = new Layout(ns, data.edges, { seed: 3 }); b.settle();
    expect(a.nodes.map((n) => [n.x.toFixed(6), n.y.toFixed(6)])).toEqual(b.nodes.map((n) => [n.x.toFixed(6), n.y.toFixed(6)]));
    const c = new Layout(ns, data.edges, { seed: 99 }); c.settle();
    expect(c.nodes.map((n) => n.x.toFixed(3))).not.toEqual(a.nodes.map((n) => n.x.toFixed(3)));
  });
  it("never produces NaN/Infinity, stays bounded, and settles", () => {
    const l = new Layout(ns, data.edges); l.settle();
    for (const n of l.nodes) { expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true); expect(Math.abs(n.x)).toBeLessThan(2000); }
    expect(l.step()).toBeLessThan(5);
  });
  it("connected nodes end up closer than unconnected ones (springs work, repulsion separates)", () => {
    const l = new Layout(ns, data.edges); l.settle();
    const dist = (p: string, q: string) => Math.hypot(l.get(p)!.x - l.get(q)!.x, l.get(p)!.y - l.get(q)!.y);
    expect(dist("a", "b")).toBeLessThan(dist("a", "d"));
    expect(dist("a", "b")).toBeGreaterThan(8);                         // not collapsed onto each other
  });
  it("handles empty, single, duplicate, self and dangling edges, and coincident nodes", () => {
    expect(() => new Layout([], []).settle()).not.toThrow();
    const one = new Layout([{ id: "x" }], [{ source: "x", target: "x" }, { source: "x", target: "nope" }]); one.settle();
    expect(one.nodes).toHaveLength(1);
    const dup = new Layout([{ id: "p" }, { id: "q" }], [{ source: "p", target: "q" }, { source: "q", target: "p" }, { source: "p", target: "q" }]); dup.settle();
    expect(Number.isFinite(dup.get("p")!.x)).toBe(true);
    const same = new Layout([{ id: "u" }, { id: "v" }], []); same.get("u")!.x = same.get("v")!.x = 1; same.get("u")!.y = same.get("v")!.y = 1; same.settle();
    expect(same.get("u")!.x).not.toBe(same.get("v")!.x);
  });
  it("fixed (dragged) nodes stay put, and hit-testing finds the node under a point", () => {
    const l = new Layout(ns, data.edges);
    const a = l.get("a")!; a.fixed = true; a.x = 5; a.y = 5; l.settle();
    expect([a.x, a.y]).toEqual([5, 5]);
    expect(l.hit(a.x + 1, a.y + 1)?.id).toBe("a");
    expect(l.hit(9999, 9999)).toBeNull();
    const b = l.bounds(); expect(b.maxX).toBeGreaterThan(b.minX);
  });
  it("scales to a few hundred nodes quickly", () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, degree: 2 }));
    const edges = many.slice(1).map((n, i) => ({ source: n.id, target: `n${Math.floor(i / 2)}` }));
    const t = performance.now(); new Layout(many, edges).settle(); expect(performance.now() - t).toBeLessThan(4000);
  });
});
