import { Cluster3, Planet3, RING_R, RING_TILT, Ring3, SHELL, Star3, Vec3, layoutScene } from "./space3d";
import { ShareLevel, Universe } from "./types";

// The universe as one scene description, shared by every renderer (WebGL, the SVG fallback, the list view) and by travel.
// Everything here is pure and deterministic: the same data always gives the same universe, and `posAt` says where a thing
// is at any moment, so motion is a function of time rather than state.

export type Region = "sun" | "fleet" | "stars" | "yards" | "home" | "control";
export type ObjectType = "sun" | "planet" | "moon" | "nebula" | "wormhole" | "beacon" | "station" | "shuttle" | "probe" | "comet" | "log" | "allstop" | "home" | "module" | "rock";
export type Tone = "ok" | "info" | "warn" | "bad" | "muted";

export const REGIONS: { id: Region; name: string; question: string }[] = [
  { id: "sun", name: "You", question: "How do I want AIOS to feel and behave?" },
  { id: "fleet", name: "The Fleet", question: "Which AIs do I have, and what may each know?" },
  { id: "stars", name: "The Star Fields", question: "What does AIOS remember and know?" },
  { id: "yards", name: "The Shipyards", question: "What am I working on?" },
  { id: "home", name: "Home Base", question: "Is my computer healthy, and what can AIOS do on it?" },
  { id: "control", name: "Mission Control", question: "What needs me, what happened, and how do I stop everything?" },
];
export const regionName = (r: Region) => REGIONS.find((x) => x.id === r)!.name;

/** An object as the server describes it. The renderer never invents one. */
export interface UObject {
  id: string; type: ObjectType; region: Region; name: string; job: string;
  state: { tone: Tone; text: string };
  meta?: Record<string, unknown>;      // e.g. provider, parent, station, count, size
}

export type Family = "star" | "rocky" | "gas" | "ocean" | "ice" | "lava" | "moon" | "station" | "rock" | "comet" | "cloud" | "gate" | "beacon" | "console";
export interface Look { family: Family; hue: number; seed: number; ring?: boolean; atmosphere?: boolean }
/** A Kepler orbit (eccentric when `ecc` > 0) around a fixed point or around another body (by id). */
export interface Orbit { around: Vec3 | string; radius: number; ecc: number; tilt: number; period: number; phase: number }

export interface Body extends UObject { pos: Vec3; r: number; look: Look; orbit?: Orbit; spin: number }
export interface Belt { center: Vec3; inner: number; outer: number; rocks: { id: string; angle: number; radius: number; y: number; r: number; finding: string | null }[] }
export interface World {
  bodies: Body[]; stars: Star3[]; clusters: Cluster3[]; rings: Ring3[]; belt: Belt | null;
  anchors: Record<Region, Vec3>; extent: number;
}

// ---------------------------------------------------------------- small deterministic helpers
export const hash = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const round = (n: number) => Math.round(n * 10) / 10;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const dirOnSphere = (i: number, n: number): Vec3 => { const y = n <= 1 ? 0 : 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(Math.max(0, 1 - y * y)), th = i * GOLDEN; return [Math.cos(th) * r, y, Math.sin(th) * r]; };
const at = (c: Vec3, r: number, ang: number, y = 0): Vec3 => [round(c[0] + Math.cos(ang) * r), round(c[1] + y), round(c[2] + Math.sin(ang) * r)];

export const ANCHOR_RADIUS = 720;
export const ANCHORS: Record<Region, Vec3> = {
  sun: [0, 0, 0], fleet: [0, 0, 0], stars: [0, 0, 0],
  yards: [round(Math.cos(0.45) * ANCHOR_RADIUS), 36, round(Math.sin(0.45) * ANCHOR_RADIUS)],
  home: [round(Math.cos(2.6) * ANCHOR_RADIUS), -28, round(Math.sin(2.6) * ANCHOR_RADIUS)],
  control: [round(Math.cos(4.6) * ANCHOR_RADIUS), 22, round(Math.sin(4.6) * ANCHOR_RADIUS)],
};

const PLANET_LOOK: Record<string, Look> = {
  claude: { family: "rocky", hue: 18, seed: 11, atmosphere: true },
  gemini: { family: "ocean", hue: 218, seed: 23, atmosphere: true },
  perplexity: { family: "ice", hue: 176, seed: 37, atmosphere: true },
  antigravity: { family: "gas", hue: 282, seed: 53, ring: true },
};

export function layoutWorld(u: Universe, objects: UObject[]): World {
  const scene = layoutScene(u);
  const byType = (t: ObjectType) => objects.filter((o) => o.type === t).sort((a, b) => a.id.localeCompare(b.id));
  const bodies: Body[] = [];
  const add = (o: UObject, pos: Vec3, r: number, look: Look, orbit?: Orbit, spin = 0.05 + hash(o.id) * 0.25) => bodies.push({ ...o, pos, r, look, orbit, spin });
  const sunObj = objects.find((o) => o.type === "sun");
  if (sunObj) add(sunObj, [0, 0, 0], 38, { family: "star", hue: 40, seed: 5 }, undefined, 0.02);

  // The Fleet: each planet rides the ring for how much it may be told, so changing its level moves it to another ring.
  const planets = new Map<string, Planet3>(scene.planets.map((p) => [p.ai.provider, p]));
  byType("planet").forEach((o, k) => {
    const p = planets.get(String(o.meta?.provider ?? o.id.split(":")[1]));
    if (!p) return;
    const look = PLANET_LOOK[p.ai.provider] ?? { family: "rocky" as Family, hue: 90, seed: Math.round(hash(o.id) * 100), atmosphere: true };
    add(o, p.pos, p.r + 3, look, { around: [0, 0, 0], radius: RING_R[p.level], ecc: 0, tilt: RING_TILT[p.level], period: 260 + k * 85, phase: p.angle });
  });
  const planetBody = (id: string) => bodies.find((b) => b.id === id);
  byType("moon").forEach((o, i) => {
    const parent = planetBody(String(o.meta?.parent ?? "planet:claude"));
    if (!parent) return;
    const orbit: Orbit = { around: parent.id, radius: round(parent.r * 2.2 + 6 + (i % 4) * 5), ecc: 0.02, tilt: 0.4 * ((i % 3) - 1), period: 22 + (i % 5) * 7, phase: hash(o.id) * Math.PI * 2 };
    add(o, parent.pos, 3.4, { family: "moon", hue: 40, seed: Math.round(hash(o.id) * 100) }, orbit);
  });

  // The Star Fields: memories and topics sit on a shell around you; imports, gateways and beacons share it.
  const shellSlots = scene.clusters.length;
  let slot = shellSlots;
  const shellPos = (): Vec3 => { const d = dirOnSphere(slot, Math.max(shellSlots + 6, 8)); slot++; return [round(d[0] * SHELL * 1.08), round(d[1] * SHELL * 1.08), round(d[2] * SHELL * 1.08)]; };
  for (const o of byType("nebula")) add(o, shellPos(), 70 + Math.min(40, Number(o.meta?.size ?? 0) * 4), { family: "cloud", hue: 265, seed: Math.round(hash(o.id) * 100) }, undefined, 0);
  for (const o of byType("wormhole")) add(o, shellPos(), 24, { family: "gate", hue: 200, seed: 3 }, undefined, 0.4);
  for (const o of byType("beacon")) add(o, shellPos(), 9, { family: "beacon", hue: 150, seed: 7 }, undefined, 0.6);

  // The Shipyards: stations ride a slow ring; jobs shuttle around their station; probes keep watch further out.
  const yards = ANCHORS.yards;
  const stations = byType("station");
  stations.forEach((o, i) => {
    const ang = (i / Math.max(1, stations.length)) * Math.PI * 2;
    add(o, at(yards, 110, ang, (i % 3) * 8 - 8), 17, { family: "station", hue: 150, seed: Math.round(hash(o.id) * 100) }, { around: yards, radius: 110, ecc: 0, tilt: 0.06 * (i % 3), period: 900, phase: ang });
  });
  const stationBody = (id: string) => bodies.find((b) => b.id === id);
  byType("shuttle").forEach((o, i) => {
    const st = stationBody(String(o.meta?.station ?? "")) ?? stationBody(stations[0]?.id ?? "");
    const around: Vec3 | string = st ? st.id : yards;
    add(o, st ? st.pos : yards, 3.8, { family: "station", hue: 45, seed: i }, { around, radius: st ? 34 + (i % 3) * 7 : 60, ecc: 0.05, tilt: 0.5 * (i % 3), period: 13 + (i % 4) * 3, phase: hash(o.id) * Math.PI * 2 });
  });
  byType("probe").forEach((o, i, all) => {
    const ang = (i / Math.max(1, all.length)) * Math.PI * 2 + 0.7;
    add(o, at(yards, 190, ang, 14), 6, { family: "station", hue: 190, seed: i + 5 }, { around: yards, radius: 190, ecc: 0.03, tilt: 0.22, period: 170 + i * 25, phase: ang });
  });

  // Mission Control: comets fall in on long eccentric orbits; the log and the All Stop beacon are fixed.
  const control = ANCHORS.control;
  byType("comet").forEach((o, i) => {
    const peri = 170 + i * 46, aph = 760 + i * 60, a = (peri + aph) / 2, ecc = (aph - peri) / (aph + peri);
    add(o, [round(a * (1 - ecc)), 0, 0], 6.5, { family: "comet", hue: 195 + i * 25, seed: i + 1 }, { around: [0, 0, 0], radius: a, ecc, tilt: 0.28 + i * 0.37, period: 520 + i * 140, phase: 0.9 + i * 2.1 }, 0.3);
  });
  for (const o of byType("log")) add(o, at(control, 46, 3.4, 4), 15, { family: "console", hue: 215, seed: 2 }, undefined, 0.02);
  for (const o of byType("allstop")) add(o, at(control, 46, 0.25, 12), 10, { family: "beacon", hue: 0, seed: 9 }, undefined, 0.3);

  // Home Base: a station with a module ring, and an asteroid belt of everything slowing the computer.
  const homeObj = byType("home")[0];
  const home = ANCHORS.home;
  if (homeObj) add(homeObj, home, 25, { family: "station", hue: 205, seed: 17 }, undefined, 0.03);
  byType("module").forEach((o, i, all) => {
    const ang = (i / Math.max(1, all.length)) * Math.PI * 2;
    add(o, at(home, 58, ang, 4), 7.5, { family: "station", hue: 200 + i * 18, seed: i + 20 }, { around: homeObj ? homeObj.id : home, radius: 58, ecc: 0, tilt: 0.12, period: 100 + i * 9, phase: ang });
  });
  const findings = byType("rock");
  let belt: Belt | null = null;
  if (homeObj) {
    const rocks: Belt["rocks"] = [];
    findings.forEach((o, i) => {
      const size = Math.max(2, Math.min(5, Number(o.meta?.size ?? 3)));
      rocks.push({ id: o.id, angle: (i / Math.max(1, findings.length)) * Math.PI * 2 + 0.3, radius: 150 + (i % 3) * 7, y: ((i * 7) % 11) - 5, r: size * 2.1, finding: o.id });
      add(o, at(home, 150 + (i % 3) * 7, rocks[i].angle, rocks[i].y), size * 2.1, { family: "rock", hue: 30, seed: Math.round(hash(o.id) * 100) }, { around: home, radius: 150 + (i % 3) * 7, ecc: 0, tilt: 0.1, period: 240, phase: rocks[i].angle }, 0.2);
    });
    for (let i = 0; i < 260; i++) rocks.push({ id: `dust:${i}`, angle: hash(`a${i}`) * Math.PI * 2, radius: 118 + hash(`r${i}`) * 66, y: (hash(`y${i}`) - 0.5) * 16, r: 0.9 + hash(`s${i}`) * 2.2, finding: null });
    belt = { center: home, inner: 112, outer: 190, rocks };
  }

  const extent = Math.max(scene.extent, ...bodies.map((b) => Math.hypot(...b.pos) + b.r), 0);
  return { bodies, stars: scene.stars, clusters: scene.clusters, rings: scene.rings, belt, anchors: ANCHORS, extent };
}

// ---------------------------------------------------------------- motion
/** Kepler's equation by Newton's method: the eccentric anomaly for a mean anomaly. */
const kepler = (M: number, e: number): number => { let E = e < 0.8 ? M : Math.PI; for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); return E; };

/** Where a body is at time `t` seconds. Pure: reduced motion simply keeps `t` fixed. */
export function posAt(world: World, body: Body, t: number, depth = 0): Vec3 {
  const o = body.orbit;
  if (!o || depth > 4) return body.pos;
  const center = typeof o.around === "string" ? (() => { const p = world.bodies.find((b) => b.id === o.around); return p ? posAt(world, p, t, depth + 1) : body.pos; })() : o.around;
  const M = o.phase + (2 * Math.PI * t) / o.period;
  const E = o.ecc > 0 ? kepler(((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), o.ecc) : M;
  const px = o.radius * (Math.cos(E) - o.ecc), pz = o.radius * Math.sqrt(1 - o.ecc * o.ecc) * Math.sin(E);
  return [round(center[0] + px), round(center[1] + pz * Math.sin(o.tilt)), round(center[2] + pz * Math.cos(o.tilt))];
}

export const bodyById = (w: World, id: string) => w.bodies.find((b) => b.id === id) ?? null;
export const regionOf = (w: World, id: string): Region | null => bodyById(w, id)?.region ?? (w.clusters.some((c) => `constellation:${c.name}` === id) ? "stars" : null);
export const ringLevelOf = (w: World, id: string): ShareLevel | null => { const b = bodyById(w, id); return b && b.orbit && b.type === "planet" ? (Object.entries(RING_R).find(([, r]) => r === b.orbit!.radius)?.[0] as ShareLevel) ?? null : null; };
