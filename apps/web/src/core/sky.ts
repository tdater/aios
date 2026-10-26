import { Building, Star } from "./types";

// Pure layout for the Constellation and the Skyline. Nothing here is random: the same data always draws the same picture.
export const SKY_W = 800, SKY_H = 520;
const GOLDEN = 2.399963229728653;
const round = (n: number) => Math.round(n * 10) / 10;

export interface Placed { star: Star; x: number; y: number; r: number }
export interface ClusterBox { name: string; x: number; y: number; radius: number }
export interface Layout { placed: Placed[]; clusters: ClusterBox[] }
const clusterOf = (s: Star) => s.project ?? "Everywhere";
export const starRadius = (s: Star) => 4 + Math.min(5, s.verified_uses);

/** Stars grouped by project; each group is a sunflower spiral, groups sit on a ring. */
export function layoutConstellation(stars: Star[], w = SKY_W, h = SKY_H): Layout {
  const names = [...new Set(stars.map(clusterOf))].sort((a, b) => (a === "Everywhere" ? -1 : b === "Everywhere" ? 1 : a.localeCompare(b)));
  const n = names.length;
  const cx = w / 2, cy = h / 2, ring = n <= 1 ? 0 : Math.min(w, h) * 0.3;
  const clusters: ClusterBox[] = [], placed: Placed[] = [];
  names.forEach((name, k) => {
    const ang = n <= 1 ? 0 : (k / n) * Math.PI * 2 - Math.PI / 2;
    const x0 = cx + Math.cos(ang) * ring * 1.35, y0 = cy + Math.sin(ang) * ring;
    const members = stars.filter((s) => clusterOf(s) === name).sort((a, b) => a.id.localeCompare(b.id));
    const radius = Math.min(Math.min(w, h) * (n <= 1 ? 0.42 : 0.2), 24 + Math.sqrt(members.length) * 22);
    const step = members.length > 1 ? radius / Math.sqrt(members.length) : 0;
    members.forEach((s, i) => {
      const d = step * Math.sqrt(i + 0.5), a = i * GOLDEN;
      placed.push({ star: s, x: round(x0 + Math.cos(a) * d), y: round(y0 + Math.sin(a) * d), r: starRadius(s) });
    });
    clusters.push({ name, x: round(x0), y: round(y0), radius: round(radius) });
  });
  return { placed, clusters };
}

/** Outline path of a star's shape: the memory type, never colour alone. */
export function shapePath(type: Star["type"], r: number): string {
  const p = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${round(x)} ${round(y)}`).join(" ") + " Z";
  switch (type) {
    case "decision": return p([[0, -r * 1.3], [r * 1.3, 0], [0, r * 1.3], [-r * 1.3, 0]]);
    case "fact": return p([[-r, -r], [r, -r], [r, r], [-r, r]]);
    case "procedure": return p([[0, -r * 1.3], [r * 1.2, r], [-r * 1.2, r]]);
    case "preference": return `M${-r} 0 a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
    default: return p(Array.from({ length: 10 }, (_, i) => { const rr = i % 2 ? r * 0.5 : r * 1.4, a = (i / 10) * Math.PI * 2 - Math.PI / 2; return [Math.cos(a) * rr, Math.sin(a) * rr] as [number, number]; }));
  }
}
export const SHAPE_NAME: Record<Star["type"], string> = { lesson: "star", decision: "diamond", preference: "circle", fact: "square", procedure: "triangle" };

/** What a viewer (or screen reader) is told about a star, with no hidden score. */
export function starSummary(s: Star): string {
  const used = s.uses === 0 ? "never used" : `used ${s.uses} time${s.uses === 1 ? "" : "s"}, ${s.verified_uses} followed by passing tests`;
  const st = s.state === "fresh" ? "" : `, ${s.state}`;
  return `${s.title} (${s.type}${st}): ${used}${s.hollow ? ", never verified" : ""}`;
}

// ---------------------------------------------------------------- Skyline
export const FLOOR_H = 14, B_W = 64, B_GAP = 22, MAX_FLOORS = 18;
export interface Tower { b: Building; x: number; y: number; w: number; h: number; shown: number; extra: number; windows: number }
export function layoutSkyline(bs: Building[], h = 260): { towers: Tower[]; width: number; ground: number } {
  const ground = h - 24;
  const towers = bs.map((b, i): Tower => {
    const shown = Math.min(b.floors, MAX_FLOORS), height = 22 + shown * FLOOR_H;
    return { b, x: 16 + i * (B_W + B_GAP), y: ground - height, w: B_W, h: height, shown, extra: Math.max(0, b.floors - MAX_FLOORS), windows: Math.min(b.working, 6) };
  });
  return { towers, width: 32 + Math.max(1, bs.length) * (B_W + B_GAP), ground };
}
export const buildingSummary = (b: Building) =>
  `${b.name}: ${b.floors} verified outcome${b.floors === 1 ? "" : "s"}` + (b.working ? `, ${b.working} running now` : "") + (b.waiting ? `, ${b.waiting} waiting for you` : "");
