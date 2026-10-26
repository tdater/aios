import type { World } from "../core/scene";

/** World signature: rebuild only when what things are or look like changes. Motion (pos, orbit) and size (r) are applied
 * every frame without a rebuild, so arrival animations and ring changes stay cheap. Cached per array identity. */
const sigCache = new WeakMap<object, string>();
const cached = <T extends object>(o: T, f: (o: T) => string) => { let s = sigCache.get(o); if (s === undefined) { s = f(o); sigCache.set(o, s); } return s; };
export function worldSignature(w: World): string {
  const b = cached(w.bodies, (list) => list.map((x) => `${x.id}|${x.type}|${x.look.family}|${x.look.hue}|${x.look.seed}|${x.look.ring ? 1 : 0}|${x.state.tone}`).join(";"));
  const s = cached(w.stars, (list) => list.map((x) => `${x.star.id}|${x.star.type}|${x.star.state}|${x.star.hollow ? 1 : 0}|${x.star.brightness}|${x.pos.join(",")}|${x.r}`).join(";"));
  return `${b}#${s}#${w.clusters.map((c) => `${c.name}@${c.pos.join(",")}`).join(",")}#${w.rings.map((r) => r.level).join(",")}#${w.belt?.rocks.length ?? 0}`;
}
