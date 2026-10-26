import { Body, ObjectType, UObject, World } from "./scene";
import { Vec3 } from "./space3d";

// How a new thing arrives in the universe. Pure and deterministic: an arrival is a start time plus a style, and
// `arrivalAt` says how far along it is at any moment, so the WebGL scene, the SVG fallback and the tests all agree.

export type ArrivalStyle = "launch" | "flash" | "condense" | "detach" | "tumble" | "fade";

export interface Arrival { id: string; name: string; type: ObjectType; style: ArrivalStyle; start: number; duration: number; caption: string }
export interface Frame {
  progress: number;      // 0..1 through the whole arrival
  scale: number;         // 0..1.x, how big it is drawn relative to its normal size
  alpha: number;         // 0..1
  glow: number;          // 0..1 extra brightness for the flash / settle
  trail: number;         // 0..1 length of the tail while it travels
  ring: number;          // 0..1, how much of its ring has faded in (planets)
  travel: number;        // 0..1 how far from the origin it has moved
  done: boolean;
}

export const STAGGER_MS = 700;
export const MAX_ANIMATED = 5;      // more than this at once just fade in, so a big import is not a light show
export const DURATION: Record<ArrivalStyle, number> = { launch: 2200, flash: 1600, condense: 2400, detach: 1800, tumble: 1500, fade: 600 };

const clamp = (n: number, a = 0, b = 1) => Math.min(b, Math.max(a, n));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => { const c = 1.4; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

export function styleFor(type: ObjectType, reduced = false): ArrivalStyle {
  if (reduced) return "fade";
  switch (type) {
    case "probe": case "station": case "shuttle": return "launch";
    case "nebula": case "beacon": case "wormhole": return "flash";
    case "planet": case "sun": return "condense";
    case "moon": return "detach";
    case "rock": case "comet": return "tumble";
    default: return "fade";
  }
}

const NOUN: Partial<Record<ObjectType, string>> = {
  probe: "probe", station: "project station", shuttle: "job", nebula: "memory cloud", beacon: "beacon", wormhole: "gateway",
  planet: "AI", moon: "skill", rock: "finding", comet: "alert", log: "log", module: "module",
};
const VERB: Partial<Record<ObjectType, string>> = {
  probe: "is in orbit", station: "is docked", shuttle: "has launched", nebula: "has formed", beacon: "is lit", wormhole: "is open",
  planet: "has arrived", moon: "is in orbit", rock: "drifted into the belt", comet: "is incoming",
};
export const captionFor = (o: Pick<UObject, "type" | "name">) => `New ${NOUN[o.type] ?? "object"}: ${o.name} ${VERB[o.type] ?? "has appeared"}`;

/** Which objects are new since the last look. The first look (prev === null) is not news: nothing animates on load. */
export function newObjects(prev: ReadonlySet<string> | null, objects: readonly UObject[]): UObject[] {
  if (!prev) return [];
  return objects.filter((o) => !prev.has(o.id));
}

/** Turn new objects into arrivals, staggered so they play one after another. */
export function planArrivals(fresh: readonly UObject[], now: number, reduced = false): Arrival[] {
  const sorted = [...fresh].sort((a, b) => a.id.localeCompare(b.id));
  return sorted.map((o, i) => {
    const style = i >= MAX_ANIMATED ? "fade" : styleFor(o.type, reduced);
    return { id: o.id, name: o.name, type: o.type, style, start: now + (style === "fade" ? 0 : i * STAGGER_MS), duration: DURATION[style], caption: captionFor(o) };
  });
}

/** How far along the arrival is at time `t` (milliseconds, same clock as `start`). Before it starts the thing is not there yet. */
export function arrivalAt(a: Arrival, t: number): Frame {
  const raw = (t - a.start) / a.duration;
  if (raw < 0) return { progress: 0, scale: 0, alpha: 0, glow: 0, trail: 0, ring: 0, travel: 0, done: false };
  const p = clamp(raw), done = raw >= 1;
  switch (a.style) {
    case "launch": {      // flies in from the Shipyards with a tail that shortens as it settles
      const travel = easeOutCubic(clamp(p / 0.8));
      return { progress: p, scale: 0.4 + 0.6 * easeOutBack(clamp(p / 0.8)), alpha: clamp(p / 0.15), glow: Math.sin(p * Math.PI) * 0.6, trail: (1 - travel) * (p < 0.8 ? 1 : 0), ring: 1, travel, done };
    }
    case "flash": {       // a bright pop on the shell, then a soft glow while it settles
      const pop = p < 0.2 ? p / 0.2 : 1;
      return { progress: p, scale: 0.2 + 0.8 * easeOutBack(pop), alpha: clamp(p / 0.1), glow: p < 0.2 ? p / 0.2 : Math.max(0, 1 - (p - 0.2) / 0.8) * 0.8, trail: 0, ring: 1, travel: 1, done };
    }
    case "condense": {    // dust gathers into a body, then the ring fades in
      return { progress: p, scale: easeOutCubic(clamp(p / 0.7)), alpha: clamp(p / 0.3), glow: Math.sin(clamp(p / 0.7) * Math.PI) * 0.5, trail: 0, ring: clamp((p - 0.7) / 0.3), travel: 1, done };
    }
    case "detach": {     // leaves its parent and drops into its own orbit
      const travel = easeOutCubic(p);
      return { progress: p, scale: 0.5 + 0.5 * easeOutCubic(p), alpha: clamp(p / 0.2), glow: (1 - p) * 0.4, trail: (1 - travel) * 0.6, ring: 1, travel, done };
    }
    case "tumble": {     // comes in fast from outside and slows to its place
      const travel = easeOutCubic(p);
      return { progress: p, scale: 1, alpha: clamp(p / 0.1), glow: 0.3 * (1 - p), trail: (1 - travel) * 0.8, ring: 1, travel, done };
    }
    default:             // fade: also the reduced-motion version of everything
      return { progress: p, scale: 1, alpha: p, glow: 0, trail: 0, ring: 1, travel: 1, done };
  }
}

/** Where the thing is drawn: from its origin towards its real place by `travel`. */
export function arrivalPos(from: Vec3, to: Vec3, f: Frame): Vec3 {
  return [from[0] + (to[0] - from[0]) * f.travel, from[1] + (to[1] - from[1]) * f.travel, from[2] + (to[2] - from[2]) * f.travel];
}

/** Where an arrival starts from: a moon from its planet, a probe or station from the Shipyards anchor, a rock from far out. */
export function originFor(b: Body, world: World): Vec3 {
  switch (b.type) {
    case "moon": { const parent = world.bodies.find((x) => x.id === b.meta?.parent); return parent ? parent.pos : b.pos; }
    case "probe": case "station": case "shuttle": return world.anchors.yards;
    case "rock": case "comet": return [b.pos[0] * 3, b.pos[1] * 3 + 40, b.pos[2] * 3];
    default: return b.pos;
  }
}

/** The camera should glide to the newest arrival and hold on it; this is the time window for that. */
export const holdUntil = (arrivals: readonly Arrival[]): number => arrivals.reduce((m, a) => Math.max(m, a.start + a.duration + 800), 0);
