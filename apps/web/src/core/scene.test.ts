import { describe, expect, it } from "vitest";
import { ANCHORS, REGIONS, bodyById, hash, layoutWorld, posAt, posAtExact } from "./scene";
import { sampleObjects, sampleUniverse } from "./scene.fixtures";
import { RING_R } from "./space3d";

const world = () => layoutWorld(sampleUniverse(), sampleObjects());
const d = (p: number[], q: number[] = [0, 0, 0]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

describe("the world", () => {
  it("is deterministic: the same data always gives the same universe", () => {
    const a = world(), b = layoutWorld(sampleUniverse(), [...sampleObjects()].reverse());
    const key = (w: typeof a) => w.bodies.map((x) => [x.id, ...x.pos]).sort((m, n) => String(m[0]).localeCompare(String(n[0])));
    expect(key(b)).toEqual(key(a));
    expect(hash("claude")).toBe(hash("claude"));
  });
  it("places every object the server describes, exactly once, in a region that has a name", () => {
    const w = world(), objs = sampleObjects();
    expect(w.bodies.map((b) => b.id).sort()).toEqual(objs.map((o) => o.id).sort());
    expect(new Set(w.bodies.map((b) => b.id)).size).toBe(w.bodies.length);
    for (const b of w.bodies) expect(REGIONS.map((r) => r.id)).toContain(b.region);
  });
  it("the Fleet: each planet rides the ring for how much it may be told", () => {
    const w = world();
    expect(d(bodyById(w, "planet:claude")!.pos)).toBeCloseTo(RING_R.private, 0);
    expect(d(bodyById(w, "planet:gemini")!.pos)).toBeCloseTo(RING_R.public, 0);
    expect(d(bodyById(w, "planet:antigravity")!.pos)).toBeCloseTo(RING_R.none, 0);
    expect(bodyById(w, "planet:antigravity")!.look.ring).toBe(true);
  });
  it("the outer regions sit around the sun at their own anchors, apart from each other", () => {
    const w = world();
    for (const [region, id] of [["yards", "station:calc"], ["home", "home"], ["control", "log"]] as const) {
      const b = bodyById(w, id)!;
      expect(d(b.pos, ANCHORS[region])).toBeLessThan(200);
      expect(b.region).toBe(region);
    }
    expect(d(ANCHORS.yards, ANCHORS.home)).toBeGreaterThan(400);
    expect(d(ANCHORS.home, ANCHORS.control)).toBeGreaterThan(400);
    expect(w.extent).toBeGreaterThan(700);
  });
  it("memories, topics and imports share the shell around you, and never collide", () => {
    const w = world();
    expect(w.stars).toHaveLength(70);
    const shell = ["nebula:history", "wormhole:import", "beacon:publish"].map((id) => bodyById(w, id)!);
    for (const b of shell) expect(d(b.pos)).toBeGreaterThan(400);
    for (let i = 0; i < shell.length; i++) for (let j = i + 1; j < shell.length; j++) expect(d(shell[i].pos, shell[j].pos)).toBeGreaterThan(60);
    for (const b of shell) for (const c of w.clusters) expect(d(b.pos, c.pos)).toBeGreaterThan(c.radius * 0.6);
  });
  it("the asteroid belt has one big rock per finding, plus background dust, around Home Base", () => {
    const w = world();
    expect(w.belt!.rocks.filter((r) => r.finding)).toHaveLength(5);
    expect(w.belt!.rocks.length).toBeGreaterThan(200);
    for (const r of w.belt!.rocks) expect(r.radius).toBeGreaterThan(w.belt!.inner - 2), expect(r.radius).toBeLessThan(w.belt!.outer + 2);
    expect(w.belt!.center).toEqual(ANCHORS.home);
  });
  it("no belt without a Home Base; no comets without comets", () => {
    const w = layoutWorld(sampleUniverse(), sampleObjects().filter((o) => o.type !== "home" && o.type !== "comet" && o.type !== "module" && o.type !== "rock"));
    expect(w.belt).toBeNull();
    expect(w.bodies.some((b) => b.type === "comet")).toBe(false);
  });
});

describe("motion", () => {
  it("at time zero every body is where the layout put it", () => {
    const w = world();
    for (const b of w.bodies) if (b.orbit && typeof b.orbit.around !== "string" && b.type === "planet") expect(d(posAt(w, b, 0), b.pos)).toBeLessThan(0.2);
  });
  it("a planet stays on its ring while it moves, and a full period brings it home", () => {
    const w = world(), p = bodyById(w, "planet:gemini")!;
    for (const t of [0, 40, 150, 333]) expect(d(posAt(w, p, t))).toBeCloseTo(RING_R.public, 0);
    const [x0, , z0] = posAt(w, p, 0), [x1, , z1] = posAt(w, p, p.orbit!.period);
    expect(Math.hypot(x1 - x0, z1 - z0)).toBeLessThan(1);
    expect(d(posAt(w, p, 50), posAt(w, p, 0))).toBeGreaterThan(5);
  });
  it("moons follow their planet", () => {
    const w = world(), moon = bodyById(w, "moon:review")!, planet = bodyById(w, "planet:claude")!;
    for (const t of [0, 7, 90]) expect(d(posAt(w, moon, t), posAt(w, planet, t))).toBeLessThan(moon.orbit!.radius * (1 + moon.orbit!.ecc) + 1);
    expect(d(posAt(w, moon, 0), posAt(w, moon, 5))).toBeGreaterThan(1);
  });
  it("comets swing close to the sun and far out, and are fastest near the sun", () => {
    const w = world(), c = bodyById(w, "comet:approvals")!, o = c.orbit!;
    const dist = Array.from({ length: 200 }, (_, i) => d(posAt(w, c, (i / 200) * o.period)));
    expect(Math.min(...dist)).toBeLessThan(220);
    expect(Math.max(...dist)).toBeGreaterThan(650);
    const step = (t: number) => d(posAt(w, c, t + 2), posAt(w, c, t));
    const near = dist.indexOf(Math.min(...dist)), far = dist.indexOf(Math.max(...dist));
    expect(step((near / 200) * o.period)).toBeGreaterThan(step((far / 200) * o.period));
  });
  it("shuttles circle their own station", () => {
    const w = world(), s = bodyById(w, "shuttle:1")!, st = bodyById(w, "station:blog")!;
    for (const t of [0, 3, 8]) expect(d(posAt(w, s, t), posAt(w, st, t))).toBeLessThan(60);
  });
});

describe("smooth motion and spread", () => {
  it("the exact position is within rounding of the steady one", () => {
    const world = layoutWorld(sampleUniverse(), sampleObjects());
    for (const b of world.bodies) for (const t of [0, 3.7, 91]) {
      const a = posAt(world, b, t), e = posAtExact(world, b, t);
      a.forEach((v, i) => expect(Math.abs(v - e[i])).toBeLessThan(0.1));
    }
  });
  it("names that differ by one character give unrelated numbers (no streaks of look-alike rocks)", () => {
    const xs = Array.from({ length: 200 }, (_, i) => hash(`a${i}`));
    const ys = Array.from({ length: 200 }, (_, i) => hash(`r${i}`));
    const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
    const mx = mean(xs), my = mean(ys);
    const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.length;
    const corr = cov / Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) / xs.length) / Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0) / ys.length);
    expect(Math.abs(corr)).toBeLessThan(0.2);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.9);
  });
});
