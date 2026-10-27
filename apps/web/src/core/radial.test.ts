import { describe, expect, it } from "vitest";
import { Layout, radialPositions } from "./graphLayout";

const E = (a: string, b: string) => ({ source: a, target: b });
const ids = ["hub", "a", "b", "c", "a1", "a2", "far", "lonely"];
const edges = [E("hub", "a"), E("hub", "b"), E("hub", "c"), E("a", "a1"), E("a", "a2"), E("far", "far2")];

describe("radial mind-map layout", () => {
  const pos = radialPositions(ids, edges, "hub");
  const dist = (id: string) => Math.hypot(pos.get(id)!.x, pos.get(id)!.y);

  it("puts the centre in the middle, neighbours on an inner ring, their neighbours outside that, and strays outermost", () => {
    expect(pos.get("hub")).toEqual({ x: 0, y: 0 });
    for (const id of ["a", "b", "c"]) expect(dist(id)).toBeCloseTo(130, 5);
    for (const id of ["a1", "a2"]) expect(dist(id)).toBeGreaterThanOrEqual(260 - 1e-6);
    for (const id of ["far", "lonely"]) expect(dist(id)).toBeGreaterThan(dist("a1") - 1e-6);
    expect(pos.has("far2")).toBe(false);                                           // an edge to a node that is not in the graph is ignored
  });
  it("is deterministic, and gives every node its own spot", () => {
    expect(radialPositions([...ids].reverse(), edges, "hub")).toEqual(pos);
    const spots = new Set([...pos.values()].map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));
    expect(spots.size).toBe(ids.length);
  });
  it("grows a crowded ring so nodes do not sit on top of each other", () => {
    const many = Array.from({ length: 60 }, (_, i) => `n${i}`);
    const p = radialPositions(["c", ...many], many.map((n) => E("c", n)), "c");
    const r = Math.hypot(p.get("n0")!.x, p.get("n0")!.y);
    expect(r).toBeGreaterThan(130);
    const a = p.get("n0")!, b = p.get("n1")!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(30);
  });
  it("returns nothing when the centre is not in the graph, and Layout.pin fixes nodes there", () => {
    expect(radialPositions(ids, edges, "missing").size).toBe(0);
    const l = new Layout(ids.map((id) => ({ id })), edges);
    l.pin(pos);
    l.step();
    expect(l.get("a")).toMatchObject({ x: pos.get("a")!.x, y: pos.get("a")!.y, fixed: true });
  });
});
