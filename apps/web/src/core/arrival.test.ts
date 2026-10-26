import { describe, expect, it } from "vitest";
import { MAX_ANIMATED, STAGGER_MS, applyArrivals, arrivalAt, arrivalPos, captionFor, newObjects, originFor, planArrivals, styleFor } from "./arrival";
import { layoutWorld, ObjectType, UObject } from "./scene";
import { sampleObjects, sampleUniverse } from "./scene.fixtures";

const obj = (id: string, type: ObjectType): UObject => ({ id, type, region: "yards", name: id, job: "", state: { tone: "ok", text: "" } });

describe("arrival planning", () => {
  it("never animates the first look at the universe", () => {
    expect(newObjects(null, [obj("a", "probe")])).toEqual([]);
    expect(newObjects(new Set(["a"]), [obj("a", "probe"), obj("b", "probe")]).map((o) => o.id)).toEqual(["b"]);
  });
  it("picks a style per kind of thing, and a plain fade when motion is reduced", () => {
    expect(styleFor("probe")).toBe("launch");
    expect(styleFor("nebula")).toBe("flash");
    expect(styleFor("planet")).toBe("condense");
    expect(styleFor("moon")).toBe("detach");
    expect(styleFor("rock")).toBe("tumble");
    for (const t of ["probe", "nebula", "planet", "moon", "rock", "comet"] as ObjectType[]) expect(styleFor(t, true)).toBe("fade");
  });
  it("staggers arrivals and turns a big batch into quiet fades", () => {
    const many = Array.from({ length: 12 }, (_, i) => obj(`p${String(i).padStart(2, "0")}`, "probe"));
    const plan = planArrivals(many, 1000);
    expect(plan.filter((a) => a.style !== "fade")).toHaveLength(MAX_ANIMATED);
    expect(plan[1].start - plan[0].start).toBe(STAGGER_MS);
    expect(plan.slice(MAX_ANIMATED).every((a) => a.style === "fade" && a.start === 1000)).toBe(true);
  });
  it("says what happened in plain words", () => {
    expect(captionFor({ type: "probe", name: "Top 3" })).toBe("New probe: Top 3 is in orbit");
    expect(captionFor({ type: "rock", name: "Big temp folder" })).toContain("finding");
  });
});

describe("arrival frames", () => {
  const types: ObjectType[] = ["probe", "nebula", "planet", "moon", "rock", "log"];
  it("is invisible before it starts, finished after it ends, and always in range", () => {
    for (const type of types) for (const reduced of [false, true]) {
      const [a] = planArrivals([obj("x", type)], 500, reduced);
      const before = arrivalAt(a, 400);
      expect(before.alpha).toBe(0); expect(before.done).toBe(false);
      for (let t = a.start; t <= a.start + a.duration + 50; t += 50) {
        const f = arrivalAt(a, t);
        expect(f.alpha).toBeGreaterThanOrEqual(0); expect(f.alpha).toBeLessThanOrEqual(1);
        expect(f.travel).toBeGreaterThanOrEqual(0); expect(f.travel).toBeLessThanOrEqual(1);
        expect(f.glow).toBeGreaterThanOrEqual(0); expect(f.scale).toBeGreaterThanOrEqual(0);
      }
      const end = arrivalAt(a, a.start + a.duration);
      expect(end).toMatchObject({ done: true, alpha: 1, travel: 1, ring: 1, trail: 0 });
      expect(end.scale).toBeCloseTo(1, 5);
    }
  });
  it("planets get their ring last", () => {
    const [a] = planArrivals([obj("pl", "planet")], 0);
    expect(arrivalAt(a, a.duration * 0.5).ring).toBe(0);
    expect(arrivalAt(a, a.duration * 0.9).ring).toBeGreaterThan(0);
  });
  it("probes travel from the Shipyards and moons from their planet", () => {
    const world = layoutWorld(sampleUniverse(), sampleObjects());
    const probe = world.bodies.find((b) => b.type === "probe"), moon = world.bodies.find((b) => b.type === "moon");
    for (const b of [probe, moon]) {
      if (!b) continue;
      const from = originFor(b, world), [a] = planArrivals([b], 0);
      expect(arrivalPos(from, b.pos, arrivalAt(a, 0.001))).toEqual(expect.arrayContaining([expect.any(Number)]));
      arrivalPos(from, b.pos, arrivalAt(a, a.duration)).forEach((v, i) => expect(v).toBeCloseTo(b.pos[i], 6));
    }
    if (probe) expect(originFor(probe, world)).toEqual(world.anchors.yards);
  });
});

describe("applyArrivals", () => {
  it("moves only the arriving thing, and hands back the same world when nothing arrives", () => {
    const world = layoutWorld(sampleUniverse(), sampleObjects());
    expect(applyArrivals(world, [], 0, 0)).toBe(world);
    const b = world.bodies.find((x) => x.type === "probe")!;
    const [a] = planArrivals([b], 0);
    const mid = applyArrivals(world, [a], a.duration * 0.3, 5);
    const moved = mid.bodies.find((x) => x.id === b.id)!;
    expect(moved.r).toBeLessThan(b.r);
    expect(moved.orbit).toBeUndefined();
    expect(mid.bodies.filter((x) => x.id !== b.id)).toEqual(world.bodies.filter((x) => x.id !== b.id));
    const end = applyArrivals(world, [a], a.duration * 2, 5);
    expect(end.bodies.find((x) => x.id === b.id)).toEqual(b);
  });
});
