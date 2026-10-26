import { describe, expect, it } from "vitest";
import { Camera, MAX_DIST, MAX_PITCH, MIN_DIST, NEAR, RING_R, SHELL, clampCamera, defaultCamera, flyTo, layoutScene, lerpCamera, orbit, pan, posOf, project, projectScene, ringPoint, zoom } from "./space3d";
import { AiPlanet, Star, Universe } from "./types";

const V = { w: 800, h: 520, focal: 560 };
const star = (id: string, o: Partial<Star> = {}): Star => ({ id, title: `T${id}`, type: "fact", scope: "global", project_id: null, project: null, state: "fresh", uses: 0, verified_uses: 0, hollow: false, last_used: null, last_verified: null, brightness: 0.1, ...o });
const ai = (provider: string, level: AiPlanet["level"], told: string[] = []): AiPlanet => ({ provider, name: provider, mode: "manual", level, default_level: level, told, told_count: told.length });
const uni = (o: Partial<Universe> = {}): Universe => ({ you: { approved: 4, suggested: 0, learning: true },
  ais: [ai("claude", "private", ["a"]), ai("gemini", "public"), ai("perplexity", "public"), ai("antigravity", "none")],
  stars: [star("a", { project: "Calc" }), star("b", { project: "Calc" }), star("c"), star("d", { project: "Blog", verified_uses: 3 })], links: [], clusters: ["Everywhere", "Blog", "Calc"],
  totals: { stars: 4, verified: 1, hollow: 0, stale: 0 }, comets: { approvals: 0, blocked: 0, to_review: 0 }, paused: false, ...o });
const dist3 = (p: number[]) => Math.hypot(p[0], p[1], p[2]);

describe("the camera", () => {
  it("whatever it looks at sits in the middle of the screen, however you turn", () => {
    for (const cam of [defaultCamera(), { yaw: 2, pitch: -0.7, dist: 300, target: [40, -20, 90] as [number, number, number] }]) {
      const p = project(cam, cam.target, V)!;
      expect([p.x, p.y]).toEqual([400, 260]);
      expect(p.depth).toBeCloseTo(cam.dist, 1);
    }
  });
  it("things nearer the camera look bigger and are drawn later", () => {
    const cam: Camera = { yaw: 0, pitch: 0, dist: 500, target: [0, 0, 0] };
    const nearer = project(cam, [0, 0, -100], V)!, farther = project(cam, [0, 0, 100], V)!;
    expect(nearer.scale).toBeGreaterThan(farther.scale);
    expect(nearer.depth).toBeLessThan(farther.depth);
  });
  it("turning keeps the target fixed, wraps the angle, and cannot flip over the top", () => {
    const c = orbit(defaultCamera(), 10, 10);
    expect(c.pitch).toBeCloseTo(MAX_PITCH, 5);
    expect(Math.abs(c.yaw)).toBeLessThanOrEqual(Math.PI);
    expect(c.target).toEqual([0, 0, 0]);
    expect(orbit(defaultCamera(), 0, -10).pitch).toBeCloseTo(-MAX_PITCH, 5);
  });
  it("zooming is limited so you can neither pass through everything nor lose it", () => {
    expect(zoom(defaultCamera(), 1000).dist).toBe(MAX_DIST);
    expect(zoom(defaultCamera(), 0.0001).dist).toBe(MIN_DIST);
    expect(zoom(defaultCamera(), 0.5).dist).toBeCloseTo(defaultCamera().dist / 2, 5);
  });
  it("anything behind or on top of the camera is not drawn", () => {
    const cam: Camera = { yaw: 0, pitch: 0, dist: 100, target: [0, 0, 0] };
    expect(project(cam, [0, 0, -(100 - NEAR + 1)], V)).toBeNull();              // almost touching the lens
    expect(project(cam, [0, 0, -400], V)).toBeNull();                           // behind the camera
    expect(project(cam, [0, 0, -50], V)).not.toBeNull();
  });
  it("flying to something moves the target onto it and comes in close; the tween takes the short way round", () => {
    const cam = flyTo(defaultCamera(), [100, 20, -50]);
    expect(cam.target).toEqual([100, 20, -50]);
    expect(cam.dist).toBe(190);
    const a: Camera = { ...defaultCamera(), yaw: 3 }, b: Camera = { ...defaultCamera(), yaw: -3 };
    expect(Math.abs(lerpCamera(a, b, 0.5).yaw)).toBeGreaterThan(3);              // through +-pi, not through 0
    expect(lerpCamera(a, b, 0).yaw).toBeCloseTo(3, 5);
    expect(lerpCamera(a, b, 1).yaw).toBeCloseTo(-3, 5);
  });
  it("panning slides the target sideways and up, and stays within limits", () => {
    const c = pan({ yaw: 0, pitch: 0, dist: 500, target: [0, 0, 0] }, 30, 10);
    expect(c.target).toEqual([30, 10, 0]);
    expect(clampCamera({ ...c, dist: 1 }).dist).toBe(MIN_DIST);
  });
});

describe("the 3D layout", () => {
  it("is deterministic and does not depend on input order", () => {
    const a = layoutScene(uni()), b = layoutScene(uni({ stars: [...uni().stars].reverse(), ais: [...uni().ais].reverse() }));
    const key = (s: ReturnType<typeof layoutScene>) => [s.planets.map((p) => [p.ai.provider, ...p.pos]).sort(), s.stars.map((p) => [p.star.id, ...p.pos]).sort()];
    expect(key(b)).toEqual(key(a));
  });
  it("puts each AI on the ring for its level, at that ring's distance from you in 3D", () => {
    const s = layoutScene(uni());
    const d = Object.fromEntries(s.planets.map((p) => [p.ai.provider, Math.round(dist3(p.pos))]));
    expect(d).toEqual({ antigravity: RING_R.none, claude: RING_R.private, gemini: RING_R.public, perplexity: RING_R.public });
    expect(s.rings.map((r) => r.level)).toEqual(["private", "public", "none"]);
    for (const r of s.rings) for (const p of r.points) expect(Math.round(dist3(p))).toBe(RING_R[r.level]);
    expect(ringPoint("private", 0)).toEqual([RING_R.private, 0, 0]);
  });
  it("rings are tilted differently so they read as separate orbits in space", () => {
    const s = layoutScene(uni());
    const ys = (lvl: string) => Math.max(...s.rings.find((r) => r.level === lvl)!.points.map((p) => Math.abs(p[1])));
    expect(ys("private")).toBe(0);
    expect(ys("public")).toBeGreaterThan(10);
    expect(ys("none")).toBeGreaterThan(10);
  });
  it("places each group of memories on a shell around you, with its stars inside the group's ball", () => {
    const s = layoutScene(uni());
    expect(s.clusters.map((c) => c.name)).toEqual(["Everywhere", "Blog", "Calc"]);
    for (const c of s.clusters) expect(Math.round(dist3(c.pos))).toBe(SHELL);
    for (const st of s.stars) {
      const c = s.clusters.find((x) => x.name === (st.star.project ?? "Everywhere"))!;
      expect(dist3([st.pos[0] - c.pos[0], st.pos[1] - c.pos[1], st.pos[2] - c.pos[2]])).toBeLessThanOrEqual(c.radius + 0.5);
      expect(dist3(st.pos)).toBeGreaterThan(RING_R.none + 40);                    // never in among the planets
    }
    expect(s.stars.find((x) => x.star.id === "d")!.r).toBeGreaterThan(s.stars.find((x) => x.star.id === "a")!.r);
  });
  it("never stacks two stars on the same spot, even in a crowd", () => {
    const many = Array.from({ length: 80 }, (_, i) => star(String(i).padStart(3, "0"), { project: "Big" }));
    const s = layoutScene(uni({ stars: many, clusters: ["Big"] }));
    expect(new Set(s.stars.map((x) => x.pos.join(","))).size).toBe(80);
  });
  it("handles an empty universe and a single group", () => {
    const e = layoutScene(uni({ stars: [], clusters: [], ais: [] }));
    expect([e.planets.length, e.stars.length, e.clusters.length]).toEqual([0, 0, 0]);
    const one = layoutScene(uni({ stars: [star("x")], clusters: ["Everywhere"] }));
    expect(one.clusters).toHaveLength(1);
    expect(Math.round(dist3(one.clusters[0].pos))).toBe(SHELL);
  });
});

describe("the scene on screen", () => {
  it("draws far things first so near things end up on top", () => {
    const f = projectScene(layoutScene(uni()), defaultCamera(), V);
    const depths = f.stars.map((s) => s.depth);
    expect(depths).toEqual([...depths].sort((a, b) => b - a));
    expect(f.core).not.toBeNull();
  });
  it("traveling really changes what you see: flying to a planet puts it in the middle and makes it large", () => {
    const sc = layoutScene(uni());
    const pos = posOf(sc, { kind: "planet", provider: "gemini" })!;
    const before = projectScene(sc, defaultCamera(), V).planets.find((p) => p.item.ai.provider === "gemini")!;
    const after = projectScene(sc, flyTo(defaultCamera(), pos), V).planets.find((p) => p.item.ai.provider === "gemini")!;
    expect([after.x, after.y]).toEqual([400, 260]);
    expect(after.scale).toBeGreaterThan(before.scale * 2);
  });
  it("lights beams from the chosen AI to exactly the memories it was told, and nothing otherwise", () => {
    const sc = layoutScene(uni());
    expect(projectScene(sc, defaultCamera(), V).beams).toEqual([]);
    const f = projectScene(sc, defaultCamera(), V, "claude", ["a", "zzz"]);
    expect(f.beams.map((b) => b.key)).toEqual(["a"]);
    expect(projectScene(sc, defaultCamera(), V, "nobody", ["a"]).beams).toEqual([]);
  });
  it("breaks a ring's outline where it passes behind the camera instead of drawing across the screen", () => {
    const sc = layoutScene(uni());
    const inside = projectScene(sc, { yaw: 0, pitch: 0, dist: 120, target: [0, 0, 0] }, V);
    expect(inside.rings.every((r) => (r.d.match(/M/g) ?? []).length >= 1)).toBe(true);
    expect(inside.rings.some((r) => (r.d.match(/M/g) ?? []).length > 1)).toBe(true);
  });
  it("far things fade but never vanish", () => {
    const sc = layoutScene(uni());
    for (const s of projectScene(sc, defaultCamera(), V).stars) { expect(s.opacity).toBeGreaterThanOrEqual(0.3); expect(s.opacity).toBeLessThanOrEqual(1); }
  });
});
