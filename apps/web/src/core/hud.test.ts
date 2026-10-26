import { describe, expect, it } from "vitest";
import { needsYou, systems, tiles } from "./hud";
import { sampleObjects } from "./scene.fixtures";

describe("the glass panels", () => {
  it("counts only what the server says, and flags anything stuck", () => {
    const t = Object.fromEntries(tiles(sampleObjects(), 70).map((x) => [x.id, x]));
    expect(t.jobs.value).toBe(2);                                    // two shuttles are working; the third waits on you
    expect(t.memories.value).toBe(70);
    expect(t.probes.value).toBe(3);
    expect(tiles(sampleObjects(), null).some((x) => x.id === "memories")).toBe(false);   // no number, no tile
    const withCounts = sampleObjects().map((o) => (o.id === "comet:approvals" ? { ...o, meta: { count: 4 } } : o.id === "comet:blocked" ? { ...o, meta: { count: 1 } } : o));
    const w = tiles(withCounts, 5).find((x) => x.id === "waiting")!;
    expect(w.value).toBe(5); expect(w.tone).toBe("bad");
  });
  it("lists each system with its state, and marks what needs you", () => {
    const s = systems(sampleObjects());
    expect(s.length).toBeGreaterThan(1);
    expect(s.every((r) => r.name && r.text)).toBe(true);
    expect(needsYou(sampleObjects().find((o) => o.id === "comet:approvals")!)).toBe(true);
    expect(needsYou(sampleObjects().find((o) => o.id === "log")!)).toBe(false);
  });
});
