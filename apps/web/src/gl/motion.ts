import type { Body, World } from "../core/scene";
import { Vec3 } from "../core/space3d";

// Smooth positions for animation. posAt() rounds to 0.1 world units (fine for labels, but visible as stepping when the
// camera is close), so the renderer evaluates the same Kepler orbit without rounding. gl.motion.test.ts keeps the two
// within that rounding of each other, so labels and drawn bodies always agree.
const kepler = (M: number, e: number): number => { let E = e < 0.8 ? M : Math.PI; for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); return E; };

export function posExact(world: World, body: Body, t: number, index?: Map<string, Body>, depth = 0): Vec3 {
  const o = body.orbit;
  if (!o || depth > 4) return body.pos;
  let center: Vec3;
  if (typeof o.around === "string") {
    const p = index ? index.get(o.around) : world.bodies.find((b) => b.id === o.around);
    center = p ? posExact(world, p, t, index, depth + 1) : body.pos;
  } else center = o.around;
  const M = o.phase + (2 * Math.PI * t) / o.period;
  const E = o.ecc > 0 ? kepler(((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), o.ecc) : M;
  const px = o.radius * (Math.cos(E) - o.ecc), pz = o.radius * Math.sqrt(1 - o.ecc * o.ecc) * Math.sin(E);
  return [center[0] + px, center[1] + pz * Math.sin(o.tilt), center[2] + pz * Math.cos(o.tilt)];
}

/** Every body's position at time t, computed once per frame. */
export function positionsAt(world: World, t: number): Map<string, Vec3> {
  const index = new Map(world.bodies.map((b) => [b.id, b] as const));
  const out = new Map<string, Vec3>();
  for (const b of world.bodies) out.set(b.id, posExact(world, b, t, index));
  return out;
}
