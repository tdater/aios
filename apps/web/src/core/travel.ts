import { rank } from "./fuzzy";
import { Body, REGIONS, Region, World, posAtExact, regionName } from "./scene";
import { Camera, Vec3, View, clampCamera, defaultCamera, flyTo, project } from "./space3d";

// Travel: how a person moves around the universe. Pure functions, so the dock, Go to, the radar, the breadcrumb and
// deep links all agree and can be tested without a screen.

/** Where the camera rests to look at a whole region. */
export function regionCamera(world: World, region: Region, from: Camera = defaultCamera()): Camera {
  if (region === "sun") return flyTo(from, [0, 0, 0], 220);
  if (region === "fleet" || region === "stars") return clampCamera({ ...defaultCamera(), dist: region === "stars" ? 980 : 520 });
  return flyTo(from, world.anchors[region], 300);
}

export function cameraForBody(b: Body, from: Camera, pos: Vec3 = b.pos): Camera {
  return flyTo(from, pos, Math.max(110, b.r * 6 + 70));
}

export interface Destination { kind: "region" | "object"; id: string; label: string; sub: string; region: Region }

/** Everything you can travel to, for Go to and the screen-reader list. */
export function destinations(world: World): Destination[] {
  const regions: Destination[] = REGIONS.map((r) => ({ kind: "region", id: r.id, label: r.name, sub: r.question, region: r.id }));
  const objects: Destination[] = world.bodies.map((b) => ({ kind: "object", id: b.id, label: b.name, sub: `${regionName(b.region)} · ${b.job}`, region: b.region }));
  return [...regions, ...objects];
}

export function goTo(world: World, query: string, limit = 8): Destination[] {
  const all = destinations(world);
  const q = query.trim();
  if (!q) return all.slice(0, limit);
  return rank(q, all, (d) => `${d.label} ${d.sub}`, limit).map((r) => r.item);
}

/** "Universe › Shipyards › Top 3" */
export function breadcrumb(world: World, selectedId: string | null, region: Region | null): string[] {
  const crumbs = ["Universe"];
  const b = selectedId ? world.bodies.find((x) => x.id === selectedId) : null;
  const r = b?.region ?? region;
  if (r) crumbs.push(regionName(r));
  if (b) crumbs.push(b.name);
  return crumbs;
}

/** The nearest region to a camera target, for the radar and the breadcrumb while flying freely. */
export function regionNear(world: World, target: Vec3): Region {
  let best: Region = "sun", bestD = Math.hypot(...target);
  for (const r of ["yards", "home", "control"] as Region[]) {
    const a = world.anchors[r], d = Math.hypot(a[0] - target[0], a[1] - target[1], a[2] - target[2]);
    if (d < bestD && d < 420) { best = r; bestD = d; }
  }
  return best;
}

// ---------------------------------------------------------------- deep links: #/home/o/<object id>
export const objectLink = (id: string) => `#/home/o/${encodeURIComponent(id)}`;

/** Radar blips: every object as a point on a small flat map, scaled to fit. */
export function radar(world: World, size: number): { id: string; x: number; y: number; region: Region }[] {
  const e = Math.max(world.extent, 1);
  return world.bodies.map((b) => ({ id: b.id, region: b.region, x: size / 2 + (b.pos[0] / e) * (size / 2 - 4), y: size / 2 + (b.pos[2] / e) * (size / 2 - 4) }));
}

/** The body under a click at (x, y) on the screen, or null. Works for every renderer because it uses the same projection as the labels.
 *  Hit size is the drawn size plus a finger-friendly margin; when several overlap, the one nearest the pointer (then the nearest to you) wins. */
export function pickBody(world: World, cam: Camera, view: View, t: number, x: number, y: number, margin = 14): Body | null {
  let best: { b: Body; d: number; depth: number } | null = null;
  for (const b of world.bodies) {
    const p = project(cam, posAtExact(world, b, t), view);
    if (!p) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d > Math.max(margin, b.r * p.scale + margin / 2)) continue;
    if (!best || d < best.d - 0.5 || (Math.abs(d - best.d) <= 0.5 && p.depth < best.depth)) best = { b, d, depth: p.depth };
  }
  return best ? best.b : null;
}
