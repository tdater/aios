import { BufferGeometry, Group, Mesh, MeshBasicMaterial, ShaderMaterial, Texture } from "three";
import { describe, expect, it, vi } from "vitest";
import { layoutWorld, posAt } from "../core/scene";
import { sampleObjects, sampleUniverse } from "../core/scene.fixtures";
import { isWebGL2Available, unsupportedReason } from "../gl/capabilities";
import { GLYPHS, glyphFor, moduleKind } from "../gl/craft";
import { QualityGovernor, settingsFor } from "../gl/governor";
import { constellationEdges, memoryAttributes, starKey } from "../gl/memories";
import { posExact, positionsAt } from "../gl/motion";
import { locate } from "../gl/overlays";
import { cometActivity, hsl, mulberry32, planetParams, temperatureColor } from "../gl/procedural";
import { ResourceTracker } from "../gl/resources";
import { backgroundStars } from "../gl/sky";
import { worldSignature } from "../gl/signature";

const world = layoutWorld(sampleUniverse(), sampleObjects());

describe("quality governor", () => {
  it("steps down only after frames stay over budget for the whole window", () => {
    const g = new QualityGovernor(24, 2000);
    let t = 0;
    for (let i = 0; i < 60; i++) { t += 30; expect(g.sample(30, t)).toBe(false); }       // 1.8 s: not yet
    let changed = false;
    for (let i = 0; i < 10 && !changed; i++) { t += 30; changed = g.sample(30, t); }
    expect(changed).toBe(true);
    expect(g.level).toBe(1);
    expect(g.tier).toBe("medium");
  });

  it("stays high when frames are fast and ignores long gaps (tab switches)", () => {
    const g = new QualityGovernor();
    let t = 0;
    for (let i = 0; i < 600; i++) { t += 16.7; g.sample(16.7, t); }
    g.sample(5000, t + 5000);
    expect(g.level).toBe(0);
    for (let i = 0; i < 20; i++) { t += 400; g.sample(400, t); }        // one-off stalls (shader compiles) are skipped
    expect(g.level).toBe(0);
    expect(g.tier).toBe("high");
  });

  it("walks pixel ratio, then bloom, then star count, and stops at low", () => {
    const g = new QualityGovernor(24, 1000);
    let t = 0;
    for (let i = 0; i < 2000; i++) { t += 40; g.sample(40, t); }
    expect(g.level).toBe(3);
    expect(g.tier).toBe("low");
    const s = [0, 1, 2, 3].map((l) => settingsFor(l, 2));
    expect(s.map((x) => x.pixelRatio)).toEqual([2, 1, 0.75, 0.75]);
    expect(s.map((x) => x.bloom)).toEqual([true, true, false, false]);
    expect(s.map((x) => x.starFraction)).toEqual([1, 1, 1, 0.35]);
    expect(settingsFor(0, 3).pixelRatio).toBe(2);            // device pixel ratio is capped at 2
  });
});

describe("procedural parameters", () => {
  it("are deterministic per seed and differ between seeds", () => {
    const a = planetParams({ family: "rocky", hue: 18, seed: 11 });
    expect(planetParams({ family: "rocky", hue: 18, seed: 11 })).toEqual(a);
    expect(planetParams({ family: "rocky", hue: 18, seed: 12 })).not.toEqual(a);
    expect(mulberry32(5)()).toBe(mulberry32(5)());
  });

  it("stay in sensible ranges for every family", () => {
    for (const family of ["rocky", "ocean", "ice", "gas", "lava", "moon"] as const) {
      for (let seed = 0; seed < 20; seed++) {
        const p = planetParams({ family, hue: seed * 18, seed, atmosphere: true });
        expect(p.tilt).toBeGreaterThanOrEqual(0);
        expect(p.tilt).toBeLessThan(0.6);
        for (const c of [...p.colors, p.atmosphere, p.ring.tint]) for (const v of c) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
        expect(p.ring.outer).toBeGreaterThan(p.ring.inner);
      }
    }
    expect(planetParams({ family: "moon", hue: 40, seed: 1, atmosphere: true }).atmosphereStrength).toBe(0);
    expect(planetParams({ family: "star" as never, hue: 1, seed: 1 }).family).toBe("rocky");
  });

  it("colour helpers behave", () => {
    expect(hsl(0, 1, 0.5).map((v) => +v.toFixed(3))).toEqual([1, 0, 0]);
    const cool = temperatureColor(3000), hot = temperatureColor(20000);
    expect(cool[0]).toBeGreaterThan(cool[2]);
    expect(hot[2]).toBeGreaterThan(hot[0]);
  });

  it("comet tails grow and brighten nearer the sun", () => {
    const near = cometActivity(180), far = cometActivity(800);
    expect(near.length).toBeGreaterThan(far.length * 3);
    expect(near.brightness).toBeGreaterThan(far.brightness * 3);
  });

  it("background stars are seeded, on the sky sphere, and coloured", () => {
    const a = backgroundStars(500, 3), b = backgroundStars(500, 3);
    expect(Array.from(a.pos)).toEqual(Array.from(b.pos));
    for (let i = 0; i < 500; i++) expect(Math.hypot(a.pos[i * 3], a.pos[i * 3 + 1], a.pos[i * 3 + 2])).toBeCloseTo(15000, 0);
    expect(Math.max(...a.size)).toBeGreaterThan(Math.min(...a.size));
  });

  it("probe glyphs and module silhouettes are chosen deterministically", () => {
    expect(GLYPHS).toContain(glyphFor(7));
    expect(glyphFor(7)).toBe(glyphFor(7));
    expect(new Set([0, 1, 2, 3, 4, 5].map(glyphFor)).size).toBe(6);
    const mods = world.bodies.filter((b) => b.type === "module").map(moduleKind);
    expect(new Set(mods).size).toBe(mods.length);
  });
});

describe("memories", () => {
  it("styles hollow, stale and fresh stars differently", () => {
    const a = memoryAttributes(world.stars);
    const i = world.stars.findIndex((s) => s.star.hollow), j = world.stars.findIndex((s) => s.star.state === "stale" && !s.star.hollow);
    expect(a.hollow[i]).toBe(1);
    const fresh = world.stars.findIndex((s) => s.star.state === "fresh" && s.star.type === world.stars[j].star.type && s.star.brightness >= world.stars[j].star.brightness);
    expect(a.color[j * 3 + 2]).toBeLessThan(a.color[fresh * 3 + 2]);   // stale is dimmer and redder
  });

  it("links each constellation into one tree", () => {
    const edges = constellationEdges(world.stars);
    const clusters = new Set(world.stars.map((s) => s.star.project ?? "Everywhere"));
    expect(edges.length).toBe(world.stars.length - clusters.size);
    for (const [a, b] of edges) expect(world.stars[a].star.project).toBe(world.stars[b].star.project);
  });

  it("finds selections by body id, star id and constellation", () => {
    const pos = positionsAt(world, 0);
    expect(locate(world, "planet:claude", pos)?.p).toEqual(pos.get("planet:claude"));
    expect(locate(world, `star:${world.stars[0].star.id}`, pos)?.p).toEqual(world.stars[0].pos);
    expect(locate(world, `constellation:${world.clusters[0].name}`, pos)?.p).toEqual(world.clusters[0].pos);
    expect(locate(world, "nope", pos)).toBeNull();
    expect(starKey("star:mem_001")).toBe("mem_001");
    expect(starKey("mem_001")).toBe("mem_001");
  });
});

describe("motion", () => {
  it("smooth positions stay within posAt()'s rounding for every body", () => {
    for (const t of [0, 3.3, 47, 199.9, 1234.5]) {
      for (const b of world.bodies) {
        const a = posExact(world, b, t), r = posAt(world, b, t);
        for (let k = 0; k < 3; k++) expect(Math.abs(a[k] - r[k])).toBeLessThan(0.25);
      }
    }
  });
});

describe("resource tracking", () => {
  it("disposes every geometry, material and texture of a tree exactly once", () => {
    const t = new ResourceTracker();
    const geo = new BufferGeometry(), tex = new Texture(), tex2 = new Texture();
    const basic = new MeshBasicMaterial({ map: tex });
    const shader = new ShaderMaterial({ uniforms: { uMap: { value: tex2 } } });
    const root = new Group();
    root.add(new Mesh(geo, basic), new Mesh(geo, shader));
    const spies = [geo, tex, tex2, basic, shader].map((x) => vi.spyOn(x, "dispose"));
    t.track(root);
    t.track(geo);
    expect(t.size).toBe(5);
    expect(t.dispose()).toBe(5);
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
    expect(t.size).toBe(0);
    expect(t.dispose()).toBe(0);
  });
});

describe("capabilities", () => {
  it("detects WebGL2 from a canvas", () => {
    expect(isWebGL2Available(() => ({ getContext: (k: string) => (k === "webgl2" ? {} : null) }))).toBe(true);
    expect(isWebGL2Available(() => ({ getContext: () => null }))).toBe(false);
    expect(isWebGL2Available(() => ({ getContext: () => { throw new Error("blocked"); } }))).toBe(false);
    expect(unsupportedReason(() => ({ getContext: () => null }))).toMatch(/WebGL2/);
    expect(unsupportedReason(() => ({ getContext: () => ({}) }))).toBeNull();
  });

  it("reports false in jsdom (no WebGL) without throwing", () => {
    expect(isWebGL2Available()).toBe(false);
  });
});

describe("world signature", () => {
  it("ignores motion and size (applied per frame) but notices new or changed things", () => {
    const base = worldSignature(world);
    const moved = { ...world, bodies: world.bodies.map((b) => ({ ...b, pos: [1, 2, 3] as [number, number, number], r: b.r * 0.1, orbit: undefined })) };
    expect(worldSignature(moved)).toBe(base);
    const recoloured = { ...world, bodies: world.bodies.map((b, i) => (i === 1 ? { ...b, look: { ...b.look, hue: b.look.hue + 40 } } : b)) };
    expect(worldSignature(recoloured)).not.toBe(base);
    expect(worldSignature({ ...world, bodies: world.bodies.slice(1) })).not.toBe(base);
    expect(worldSignature({ ...world, stars: world.stars.slice(1) })).not.toBe(base);
  });
});
