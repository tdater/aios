import { describe, expect, it } from "vitest";
import { breadcrumb, cameraForBody, destinations, goTo, objectLink, radar, regionCamera, regionNear } from "./travel";
import { REGIONS, layoutWorld } from "./scene";
import { sampleObjects, sampleUniverse } from "./scene.fixtures";
import { defaultCamera } from "./space3d";

const world = layoutWorld(sampleUniverse(), sampleObjects());

describe("travel", () => {
  it("can reach every region and every object", () => {
    const d = destinations(world);
    expect(d.filter((x) => x.kind === "region")).toHaveLength(REGIONS.length);
    expect(d.filter((x) => x.kind === "object")).toHaveLength(world.bodies.length);
    for (const r of REGIONS) {
      const cam = regionCamera(world, r.id);
      expect(Number.isFinite(cam.dist) && cam.dist > 0).toBe(true);
    }
  });
  it("flies to a region anchor and frames a body", () => {
    expect(regionCamera(world, "yards").target).toEqual(world.anchors.yards);
    const b = world.bodies[0], cam = cameraForBody(b, defaultCamera());
    expect(cam.target).toEqual(b.pos);
  });
  it("Go to finds things by name or by the question they answer", () => {
    expect(goTo(world, "shipyards")[0]).toMatchObject({ kind: "region", id: "yards" });
    expect(goTo(world, "").length).toBeGreaterThan(0);
    const named = world.bodies.find((b) => b.type === "planet")!;
    expect(goTo(world, named.name.slice(0, 4)).some((x) => x.id === named.id)).toBe(true);
    expect(goTo(world, "zzzzqqq")).toEqual([]);
  });
  it("writes a breadcrumb and a deep link", () => {
    const b = world.bodies.find((x) => x.type === "planet")!;
    expect(breadcrumb(world, b.id, null)).toEqual(["Universe", "The Fleet", b.name]);
    expect(breadcrumb(world, null, null)).toEqual(["Universe"]);
    expect(objectLink("probe:abc 1")).toBe("#/home/o/probe%3Aabc%201");
  });
  it("knows which region you are near and plots a radar inside its box", () => {
    expect(regionNear(world, [0, 0, 0])).toBe("sun");
    expect(regionNear(world, world.anchors.home)).toBe("home");
    for (const p of radar(world, 120)) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(120); expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(120); }
  });
});

import { DEFAULT_SETTINGS } from "./settings";
import { LOCAL_DEFS, SETTING_HOME } from "./objects";
describe("every setting has a home", () => {
  it("covers every setting on this device, once", () => {
    for (const k of Object.keys(DEFAULT_SETTINGS)) expect(SETTING_HOME[k as keyof typeof DEFAULT_SETTINGS], k).toBeTruthy();
    expect(new Set(LOCAL_DEFS.map((d) => d.key)).size).toBe(LOCAL_DEFS.length);
  });
});
