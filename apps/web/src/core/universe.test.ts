import { describe, expect, it } from "vitest";
import { CORE, LEGEND, ORBIT, PLANET_STATUS, W, H, layoutUniverse, starTitles } from "./universe";
import { AiPlanet, Star, Universe } from "./types";

const star = (id: string, o: Partial<Star> = {}): Star => ({ id, title: `T${id}`, type: "fact", scope: "global", project_id: null, project: null, state: "fresh", uses: 0, verified_uses: 0, hollow: false, last_used: null, last_verified: null, brightness: 0.1, ...o });
const ai = (provider: string, level: AiPlanet["level"], mode = "manual", told: string[] = []): AiPlanet => ({ provider, name: provider, mode, level, default_level: level, told, told_count: told.length });
const uni = (o: Partial<Universe> = {}): Universe => ({
  you: { approved: 3, suggested: 1, learning: true }, ais: [ai("claude", "private", "interactive"), ai("gemini", "public"), ai("perplexity", "public"), ai("antigravity", "none")],
  stars: [star("a", { project: "Calc" }), star("b", { project: "Calc" }), star("c"), star("d", { project: "Blog" })], links: [], clusters: ["Everywhere", "Blog", "Calc"],
  totals: { stars: 4, verified: 0, hollow: 0, stale: 0 }, comets: { approvals: 2, blocked: 0, to_review: 1 }, paused: false, ...o });

describe("layoutUniverse", () => {
  it("is deterministic", () => {
    const a = layoutUniverse(uni()), b = layoutUniverse(uni({ ais: [...uni().ais].reverse(), stars: [...uni().stars].reverse() }));
    const key = (l: ReturnType<typeof layoutUniverse>) => [l.planets.map((p) => [p.ai.provider, p.x, p.y]).sort(), l.stars.map((s) => [s.star.id, s.x, s.y]).sort()];
    expect(key(b)).toEqual(key(a));
  });
  it("puts each AI on the ring for its sharing level: private nearest you, nothing farthest", () => {
    const l = layoutUniverse(uni());
    const dist = (p: { x: number; y: number }) => Math.round(Math.hypot(p.x - CORE.x, p.y - CORE.y));
    const d = Object.fromEntries(l.planets.map((p) => [p.ai.provider, dist(p)]));
    expect(d).toEqual({ antigravity: ORBIT.none, claude: ORBIT.private, gemini: ORBIT.public, perplexity: ORBIT.public });
    expect(l.orbits.map((o) => o.level)).toEqual(["private", "public", "none"]);
  });
  it("two AIs on one ring are spread apart, and a changed level moves the planet", () => {
    const l = layoutUniverse(uni());
    const [g, p] = ["gemini", "perplexity"].map((n) => l.planets.find((x) => x.ai.provider === n)!);
    expect(Math.hypot(g.x - p.x, g.y - p.y)).toBeGreaterThan(60);
    const raised = layoutUniverse(uni({ ais: uni().ais.map((a) => (a.provider === "gemini" ? { ...a, level: "private" as const } : a)) }));
    expect(Math.round(Math.hypot(raised.planets.find((x) => x.ai.provider === "gemini")!.x - CORE.x, raised.planets.find((x) => x.ai.provider === "gemini")!.y - CORE.y))).toBe(ORBIT.private);
  });
  it("keeps every star and every planet inside the picture, clear of the core", () => {
    const l = layoutUniverse(uni());
    for (const s of l.stars) { expect(s.x).toBeGreaterThan(0); expect(s.x).toBeLessThan(W); expect(s.y).toBeGreaterThan(0); expect(s.y).toBeLessThan(H); expect(Math.hypot(s.x - CORE.x, s.y - CORE.y)).toBeGreaterThan(ORBIT.none + 20); }
    for (const p of l.planets) expect(Math.hypot(p.x - CORE.x, p.y - CORE.y)).toBeGreaterThan(CORE.r);
    expect(l.stars.length).toBe(4);
  });
  it("many stars in one group still never share a spot", () => {
    const many = Array.from({ length: 50 }, (_, i) => star(String(i).padStart(3, "0"), { project: "Big" }));
    const l = layoutUniverse(uni({ stars: many, clusters: ["Big"] }));
    expect(new Set(l.stars.map((s) => `${s.x},${s.y}`)).size).toBe(50);
  });
  it("shows only the comets that have something in them, with where each one leads", () => {
    const l = layoutUniverse(uni());
    expect(l.comets.map((c) => [c.kind, c.count, c.to])).toEqual([["approvals", 2, { tab: "inbox" }], ["review", 1, { tab: "inbox" }]]);
    expect(layoutUniverse(uni({ comets: { approvals: 0, blocked: 3, to_review: 0 } })).comets.map((c) => [c.kind, c.to])).toEqual([["blocked", { tab: "runs" }]]);
    expect(layoutUniverse(uni({ comets: { approvals: 0, blocked: 0, to_review: 0 } })).comets).toEqual([]);
  });
  it("crops the view tight around you and your AIs until there are stars or comets to show", () => {
    const empty = layoutUniverse(uni({ stars: [], clusters: [], comets: { approvals: 0, blocked: 0, to_review: 0 } }));
    expect(empty.view[2]).toBeLessThan(W / 2);
    expect([empty.view[0] + empty.view[2] / 2, empty.view[1] + empty.view[3] / 2]).toEqual([CORE.x, CORE.y]);   // still centred on you
    for (const p of empty.planets) { expect(p.x).toBeGreaterThan(empty.view[0]); expect(p.x).toBeLessThan(empty.view[0] + empty.view[2]); expect(p.y).toBeGreaterThan(empty.view[1]); expect(p.y).toBeLessThan(empty.view[1] + empty.view[3]); }
    expect(layoutUniverse(uni()).view).toEqual([0, 0, W, H]);
    expect(layoutUniverse(uni({ stars: [], clusters: [] })).view).toEqual([0, 0, W, H]);                        // comets alone still need the full width
  });
  it("copes with an empty universe", () => {
    const l = layoutUniverse(uni({ stars: [], clusters: [], ais: [], comets: { approvals: 0, blocked: 0, to_review: 0 } }));
    expect([l.planets.length, l.stars.length, l.comets.length]).toEqual([0, 0, 0]);
  });
});

describe("the legend and the words", () => {
  it("explains every kind of thing on the map, each with what it is and what it does", () => {
    expect(LEGEND.map((i) => i.id)).toEqual(["you", "ais", "rings", "stars", "groups", "comets"]);
    for (const i of LEGEND) { expect(i.what.length).toBeGreaterThan(20); expect(i.does.length).toBeGreaterThan(20); }
  });
  it("is honest about which AI is really connected", () => {
    expect(PLANET_STATUS(ai("claude", "private", "interactive"))).toMatch(/Connected through your own Claude sign-in/);
    expect(PLANET_STATUS(ai("claude", "private", "unavailable"))).toMatch(/not signed in/);
    expect(PLANET_STATUS(ai("gemini", "public"))).toMatch(/copy and paste/);
  });
  it("turns told ids into stars, ignoring ones that no longer exist", () => {
    expect(starTitles(uni(), ["a", "zzz", "c"]).map((s) => s.id)).toEqual(["a", "c"]);
  });
});
