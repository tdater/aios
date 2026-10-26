import type { Route } from "../ui/hooks";
import { Layout, layoutConstellation, starRadius } from "./sky";
import { AiPlanet, ShareLevel, Star, Universe } from "./types";

// Pure layout for the Universe. The same data always draws the same picture, and every element is one stored fact.
export const W = 800, H = 520;
export const CORE = { x: W / 2, y: H / 2, r: 30 };
export const ORBIT: Record<ShareLevel, number> = { private: 72, public: 108, none: 144 };   // nearer you = trusted with more
export const PLANET_R = 15;

export const LEVEL_TEXT: Record<ShareLevel, { short: string; long: string }> = {
  private: { short: "private", long: "may be told your public and private memories" },
  public: { short: "public only", long: "may be told only the memories you marked public" },
  none: { short: "nothing", long: "is told nothing from your memory" },
};

export interface PlacedPlanet { ai: AiPlanet; x: number; y: number; r: number; angle: number }
export interface Comet { kind: "approvals" | "blocked" | "review"; count: number; label: string; x: number; y: number; to: Route }
export interface UniverseLayout {
  planets: PlacedPlanet[]; orbits: { level: ShareLevel; r: number }[]; stars: Layout["placed"]; clusters: Layout["clusters"]; comets: Comet[];
  view: [number, number, number, number];     // the part of the picture worth showing: tight around you and your AIs until there is more to see
}

export function layoutUniverse(u: Universe): UniverseLayout {
  const byLevel = new Map<ShareLevel, AiPlanet[]>();
  for (const ai of [...u.ais].sort((a, b) => a.provider.localeCompare(b.provider))) byLevel.set(ai.level, [...(byLevel.get(ai.level) ?? []), ai]);
  const planets: PlacedPlanet[] = [];
  (["private", "public", "none"] as ShareLevel[]).forEach((level, k) => {
    const group = byLevel.get(level) ?? [];
    group.forEach((ai, i) => {
      const angle = -Math.PI / 2 + k * 0.6 + (i / group.length) * Math.PI * 2;      // each ring starts at a different angle so planets do not line up
      planets.push({ ai, angle, r: PLANET_R, x: round(CORE.x + Math.cos(angle) * ORBIT[level]), y: round(CORE.y + Math.sin(angle) * ORBIT[level]) });
    });
  });
  const sky = layoutConstellation(u.stars, W, H);
  // Move the star clusters out to an ellipse around the planets' orbits.
  const n = sky.clusters.length;
  const moved = new Map<string, { dx: number; dy: number }>();
  const clusters = sky.clusters.map((c, k) => {
    const ang = n <= 1 ? -Math.PI / 2 : (k / n) * Math.PI * 2 - Math.PI / 2 + Math.PI / n;
    const cx = CORE.x + Math.cos(ang) * 318, cy = CORE.y + Math.sin(ang) * 188;
    moved.set(c.name, { dx: cx - c.x, dy: cy - c.y });
    return { ...c, x: round(cx), y: round(cy), radius: Math.min(c.radius, 52) };
  });
  const stars = sky.placed.map((p) => {
    const m = moved.get(p.star.project ?? "Everywhere")!;
    const cl = clusters.find((c) => c.name === (p.star.project ?? "Everywhere"))!, old = sky.clusters.find((c) => c.name === cl.name)!;
    const scale = old.radius ? cl.radius / old.radius : 1;                         // shrink dense clusters into their smaller circle
    return { ...p, x: round(old.x + m.dx + (p.x - old.x) * scale), y: round(old.y + m.dy + (p.y - old.y) * scale) };
  });
  const cm = u.comets;
  const raw: Omit<Comet, "x" | "y">[] = [
    { kind: "approvals", count: cm.approvals, label: `${cm.approvals} waiting for your approval`, to: { tab: "inbox" } },
    { kind: "blocked", count: cm.blocked, label: `${cm.blocked} stuck`, to: { tab: "runs" } },
    { kind: "review", count: cm.to_review, label: `${cm.to_review} to look over`, to: { tab: "inbox" } },
  ];
  const list: Comet[] = raw.filter((c) => c.count > 0).map((c, i) => ({ ...c, x: 58, y: 44 + i * 44 }));
  const sparse = stars.length === 0 && list.length === 0;
  const pad = ORBIT.none + PLANET_R + 30;
  const view: UniverseLayout["view"] = sparse ? [CORE.x - pad, CORE.y - pad, pad * 2, pad * 2] : [0, 0, W, H];
  return { planets, orbits: (["private", "public", "none"] as ShareLevel[]).map((level) => ({ level, r: ORBIT[level] })), stars, clusters, comets: list, view };
}
const round = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------- what is what, in plain words
export interface LegendItem { id: "you" | "ais" | "stars" | "groups" | "comets" | "rings"; symbol: string; name: string; what: string; does: string }
export const LEGEND: LegendItem[] = [
  { id: "you", symbol: "◉", name: "You (the glowing centre)", what: "Everything here exists to serve you, so you sit in the middle.",
    does: "Click it to see what AIOS has learned about you, to correct it, and to switch learning off." },
  { id: "ais", symbol: "●", name: "Planets: your AIs", what: "Claude, Gemini, Perplexity and Antigravity.",
    does: "A planet closer to you may be told more of your private memories. Click one to see exactly what it has been told, and to change that." },
  { id: "rings", symbol: "○", name: "Rings: how much each AI may be told", what: "Inner ring: public and private memories. Middle: public only. Outer: nothing.",
    does: "You decide each AI's ring. Nothing marked secret is ever shared at any ring." },
  { id: "stars", symbol: "★", name: "Stars: what AIOS remembers", what: "One star per approved memory. Shape is the kind (preference, fact, decision, lesson, procedure).",
    does: "Brighter means the memory was given to an AI and the work then checked out. Hollow means it was used but never checked." },
  { id: "groups", symbol: "✶", name: "Constellations: groups of memories", what: "Memories grouped by project, or “Everywhere” when they apply to all your work.",
    does: "Click a star to see where it came from and where it has been used." },
  { id: "comets", symbol: "☄", name: "Comets: waiting for you", what: "Approvals to give, stuck work, and suggestions to look over.",
    does: "Nothing important happens without you. Click a comet to deal with it." },
];

export const PLANET_STATUS = (ai: AiPlanet): string =>
  ai.provider === "claude"
    ? (ai.mode === "interactive" ? "Connected through your own Claude sign-in. Replies come straight back." : "Not ready: Claude Code is not signed in on this PC.")
    : "Reached by copy and paste. AIOS writes the question; you paste it into the app and bring the answer back.";

export const starTitles = (u: Universe, ids: string[]): Star[] => ids.map((id) => u.stars.find((s) => s.id === id)).filter((s): s is Star => !!s);
export { starRadius };
