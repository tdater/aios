import { describe, expect, it } from "vitest";
import { MAX_FLOORS, buildingSummary, layoutConstellation, layoutSkyline, shapePath, starSummary } from "./sky";
import { Star } from "./types";

const star = (id: string, o: Partial<Star> = {}): Star => ({ id, title: `T${id}`, type: "lesson", scope: "global", project_id: null, project: null, state: "fresh", uses: 0, verified_uses: 0, hollow: false, last_used: null, last_verified: null, brightness: 0.1, ...o });

describe("layoutConstellation", () => {
  const stars = [star("a", { project: "Calc" }), star("b", { project: "Calc" }), star("c", { project: "Blog" }), star("d"), star("e", { project: "Calc", verified_uses: 3 })];
  it("is deterministic and puts every star inside the canvas", () => {
    const one = layoutConstellation(stars), two = layoutConstellation([...stars].reverse());
    expect(two.placed.map((p) => [p.star.id, p.x, p.y]).sort()).toEqual(one.placed.map((p) => [p.star.id, p.x, p.y]).sort());
    for (const p of one.placed) { expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(800); expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(520); }
    expect(one.placed.length).toBe(5);
  });
  it("makes one cluster per project, with unassigned memories first as Everywhere", () => {
    expect(layoutConstellation(stars).clusters.map((c) => c.name)).toEqual(["Everywhere", "Blog", "Calc"]);
  });
  it("never stacks two stars on the same spot", () => {
    const many = Array.from({ length: 60 }, (_, i) => star(String(i).padStart(3, "0"), { project: "P" }));
    expect(new Set(layoutConstellation(many).placed.map((p) => `${p.x},${p.y}`)).size).toBe(60);
  });
  it("size comes only from verified uses, and handles an empty sky", () => {
    const l = layoutConstellation(stars);
    expect(l.placed.find((p) => p.star.id === "e")!.r).toBeGreaterThan(l.placed.find((p) => p.star.id === "a")!.r);
    expect(layoutConstellation([])).toEqual({ placed: [], clusters: [] });
  });
});

describe("shapes and summaries", () => {
  it("each memory type has its own closed outline", () => {
    const paths = (["lesson", "decision", "preference", "fact", "procedure"] as const).map((t) => shapePath(t, 6));
    expect(new Set(paths).size).toBe(5);
    paths.forEach((p) => expect(p.endsWith("Z")).toBe(true));
  });
  it("summaries say exactly what is and is not known", () => {
    expect(starSummary(star("a"))).toBe("Ta (lesson): never used");
    expect(starSummary(star("a", { uses: 2, hollow: true, state: "stale" }))).toBe("Ta (lesson, stale): used 2 times, 0 followed by passing tests, never verified");
    expect(starSummary(star("a", { uses: 1, verified_uses: 1 }))).toContain("used 1 time, 1 followed by passing tests");
  });
});

describe("layoutSkyline", () => {
  it("one tower per project; floors cap with a count of the rest; windows cap at six", () => {
    const { towers, width } = layoutSkyline([{ id: "1", name: "A", floors: 3, working: 9, waiting: 0, conversations: 1 }, { id: "2", name: "B", floors: 30, working: 0, waiting: 1, conversations: 0 }]);
    expect(towers.map((t) => [t.shown, t.extra, t.windows])).toEqual([[3, 0, 6], [MAX_FLOORS, 30 - MAX_FLOORS, 0]]);
    expect(towers[1].h).toBeGreaterThan(towers[0].h);
    expect(towers[1].x).toBeGreaterThan(towers[0].x + towers[0].w);
    expect(width).toBeGreaterThan(towers[1].x + towers[1].w);
  });
  it("describes a building in plain words", () => {
    expect(buildingSummary({ id: "1", name: "Calc", floors: 1, working: 1, waiting: 2, conversations: 1 })).toBe("Calc: 1 verified outcome, 1 running now, 2 waiting for you");
    expect(buildingSummary({ id: "1", name: "Blog", floors: 0, working: 0, waiting: 0, conversations: 0 })).toBe("Blog: 0 verified outcomes");
  });
});
