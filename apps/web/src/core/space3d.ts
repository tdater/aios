import { AiPlanet, ShareLevel, Star, Universe } from "./types";


// A small, dependency-free 3D engine for the Universe: a perspective camera that orbits a target, a deterministic 3D
// layout, and projection of the scene to screen coordinates. Everything here is pure, so travelling is testable.
export type Vec3 = [number, number, number];
export interface Camera { yaw: number; pitch: number; dist: number; target: Vec3 }
export interface View { w: number; h: number; focal: number }

export const FOCAL = 560, NEAR = 24, MIN_DIST = 70, MAX_DIST = 1500, MAX_PITCH = (85 * Math.PI) / 180;
export const SHELL = 430;                       // distance of the memory constellations from you
export const RING_R: Record<ShareLevel, number> = { private: 120, public: 175, none: 230 };   // nearer you = trusted with more
export const PLANET_R = 14;
export const RING_TILT: Record<ShareLevel, number> = { private: 0, public: 0.32, none: -0.28 };
const GOLDEN = 2.399963229728653;
const round = (n: number) => Math.round(n * 100) / 100;

/** One vertical field of view for every renderer, so labels drawn by the page line up exactly with what WebGL draws. */
export const VFOV = 2 * Math.atan(260 / FOCAL);
export const viewFor = (w: number, h: number): View => ({ w, h, focal: h / 2 / Math.tan(VFOV / 2) });
export const defaultCamera = (): Camera => ({ yaw: 0.35, pitch: 0.42, dist: 760, target: [0, 0, 0] });
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const clampCamera = (c: Camera): Camera => ({ ...c, pitch: clamp(c.pitch, -MAX_PITCH, MAX_PITCH), dist: clamp(c.dist, MIN_DIST, MAX_DIST), yaw: ((c.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI });
export const orbit = (c: Camera, dyaw: number, dpitch: number): Camera => clampCamera({ ...c, yaw: c.yaw + dyaw, pitch: c.pitch + dpitch });
export const zoom = (c: Camera, factor: number): Camera => clampCamera({ ...c, dist: c.dist * factor });
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  let dy = b.yaw - a.yaw;
  if (dy > Math.PI) dy -= 2 * Math.PI; else if (dy < -Math.PI) dy += 2 * Math.PI;          // turn the short way round
  return clampCamera({ yaw: a.yaw + dy * t, pitch: lerp(a.pitch, b.pitch, t), dist: lerp(a.dist, b.dist, t), target: [lerp(a.target[0], b.target[0], t), lerp(a.target[1], b.target[1], t), lerp(a.target[2], b.target[2], t)] });
}
/** Where to put the camera to look at something: keep the viewing angle, move the target onto it and come in close. */
export const flyTo = (c: Camera, at: Vec3, dist = 190): Camera => clampCamera({ ...c, target: at, dist });
export const pan = (c: Camera, dx: number, dy: number): Camera => {          // move the target in the screen plane
  const [rx, ry] = [Math.cos(c.yaw), Math.sin(c.yaw)];
  return clampCamera({ ...c, target: [c.target[0] + dx * rx, c.target[1] + dy, c.target[2] + dx * ry] });
};

export interface Projected { x: number; y: number; depth: number; scale: number }
/** Perspective projection. Returns null for anything behind (or almost on top of) the camera. */
export function project(c: Camera, p: Vec3, v: View): Projected | null {
  const x0 = p[0] - c.target[0], y0 = p[1] - c.target[1], z0 = p[2] - c.target[2];
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  const x1 = x0 * cy - z0 * sy, z1 = x0 * sy + z0 * cy;                         // turn around the vertical axis
  const y2 = y0 * cp - z1 * sp, z2 = y0 * sp + z1 * cp;                         // then tip up or down
  const depth = c.dist + z2;
  if (depth < NEAR) return null;
  const scale = v.focal / depth;
  return { x: round(v.w / 2 + x1 * scale), y: round(v.h / 2 - y2 * scale), depth: round(depth), scale };
}

// ---------------------------------------------------------------- the 3D layout
const fib = (i: number, n: number): Vec3 => {            // the i-th of n points spread evenly over a sphere
  const y = n <= 1 ? 0 : 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(Math.max(0, 1 - y * y)), th = i * GOLDEN;
  return [Math.cos(th) * r, y, Math.sin(th) * r];
};
const unit = (v: Vec3): Vec3 => { const n = Math.hypot(...v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
const scaleV = (v: Vec3, k: number): Vec3 => [round(v[0] * k), round(v[1] * k), round(v[2] * k)];
const addV = (a: Vec3, b: Vec3): Vec3 => [round(a[0] + b[0]), round(a[1] + b[1]), round(a[2] + b[2])];

export interface Planet3 { ai: AiPlanet; pos: Vec3; r: number; angle: number; level: ShareLevel }
export interface Star3 { star: Star; pos: Vec3; r: number }
export interface Cluster3 { name: string; pos: Vec3; radius: number }
export interface Ring3 { level: ShareLevel; points: Vec3[] }
export interface Scene3 { planets: Planet3[]; stars: Star3[]; clusters: Cluster3[]; rings: Ring3[]; extent: number }

export function ringPoint(level: ShareLevel, angle: number): Vec3 {
  const R = RING_R[level], t = RING_TILT[level], z0 = Math.sin(angle) * R;
  return [round(Math.cos(angle) * R), round(z0 * Math.sin(t)), round(z0 * Math.cos(t))];
}

export function layoutScene(u: Universe): Scene3 {
  const levels: ShareLevel[] = ["private", "public", "none"];
  const byLevel = new Map<ShareLevel, AiPlanet[]>();
  for (const ai of [...u.ais].sort((a, b) => a.provider.localeCompare(b.provider))) byLevel.set(ai.level, [...(byLevel.get(ai.level) ?? []), ai]);
  const planets: Planet3[] = [];
  levels.forEach((level, k) => {
    const group = byLevel.get(level) ?? [];
    group.forEach((ai, i) => { const angle = -Math.PI / 2 + k * 0.6 + (i / group.length) * Math.PI * 2; planets.push({ ai, r: PLANET_R, level, angle, pos: ringPoint(level, angle) }); });
  });
  const rings: Ring3[] = levels.map((level) => ({ level, points: Array.from({ length: 73 }, (_, i) => ringPoint(level, (i / 72) * Math.PI * 2)) }));

  const names = [...u.clusters].sort((a, b) => (a === "Everywhere" ? -1 : b === "Everywhere" ? 1 : a.localeCompare(b)));
  for (const s of u.stars) if (!names.includes(s.project ?? "Everywhere")) names.push(s.project ?? "Everywhere");
  const clusters: Cluster3[] = [], stars: Star3[] = [];
  names.forEach((name, k) => {
    const members = u.stars.filter((s) => (s.project ?? "Everywhere") === name).sort((a, b) => a.id.localeCompare(b.id));
    const radius = Math.min(95, 28 + Math.sqrt(members.length) * 16);
    const dir = names.length === 1 ? unit([0.25, 0.1, -0.96]) : fib(k, names.length);
    const centre = scaleV(dir, SHELL);
    clusters.push({ name, pos: centre, radius });
    members.forEach((s, i) => {
      const d = fib(i, members.length), dist = radius * Math.cbrt((i + 0.5) / Math.max(1, members.length));
      stars.push({ star: s, pos: addV(centre, scaleV(d, dist)), r: 5.5 + Math.min(6, s.verified_uses) });
    });
  });
  const extent = Math.max(RING_R.none + PLANET_R, ...clusters.map((c) => Math.hypot(...c.pos) + c.radius));
  return { planets, stars, clusters, rings, extent };
}

// ---------------------------------------------------------------- the scene on screen
export interface Drawn<T> { item: T; x: number; y: number; depth: number; scale: number; opacity: number }
export interface Frame {
  planets: Drawn<Planet3>[]; stars: Drawn<Star3>[]; clusters: Drawn<Cluster3>[];
  core: Projected | null; rings: { level: ShareLevel; d: string }[]; beams: { x1: number; y1: number; x2: number; y2: number; key: string }[];
}
const fade = (p: Projected, c: Camera) => round(clamp(1.15 - (p.depth - c.dist * 0.4) / (c.dist * 2.2 + 400), 0.3, 1));
const far = <T,>(list: Drawn<T>[]) => list.sort((a, b) => b.depth - a.depth);          // painter's order: far first, near last (on top)

export function projectScene(s: Scene3, c: Camera, v: View, beamFrom?: string, told: string[] = []): Frame {
  const draw = <T extends { pos: Vec3 }>(items: T[]): Drawn<T>[] => far(items.flatMap((item) => { const p = project(c, item.pos, v); return p ? [{ item, ...p, opacity: fade(p, c) }] : []; }));
  const planets = draw(s.planets), stars = draw(s.stars), clusters = draw(s.clusters);
  const rings = s.rings.map((r) => {
    const pts = r.points.map((p) => project(c, p, v));
    let d = "", pen = false;
    for (const q of pts) { if (!q) { pen = false; continue; } d += `${pen ? "L" : "M"}${q.x} ${q.y} `; pen = true; }
    return { level: r.level, d: d.trim() };
  });
  const from = beamFrom ? s.planets.find((p) => p.ai.provider === beamFrom) : undefined;
  const a = from ? project(c, from.pos, v) : null;
  const beams = a && from ? told.flatMap((id) => { const st = s.stars.find((x) => x.star.id === id), b = st ? project(c, st.pos, v) : null; return b ? [{ x1: a.x, y1: a.y, x2: b.x, y2: b.y, key: id }] : []; }) : [];
  return { planets, stars, clusters, core: project(c, [0, 0, 0], v), rings, beams };
}

export const posOf = (s: Scene3, what: { kind: "core" } | { kind: "planet"; provider: string } | { kind: "star"; id: string } | { kind: "cluster"; name: string }): Vec3 | null =>
  what.kind === "core" ? [0, 0, 0]
    : what.kind === "planet" ? s.planets.find((p) => p.ai.provider === what.provider)?.pos ?? null
      : what.kind === "star" ? s.stars.find((p) => p.star.id === what.id)?.pos ?? null
        : s.clusters.find((c) => c.name === what.name)?.pos ?? null;
