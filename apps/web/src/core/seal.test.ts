import { describe, expect, it } from "vitest";
import { hashBytes, sealFor, sealGeometry, sealState, sealStrength } from "./seal";
import type { Readiness } from "./types";

const H1 = "f881f328342975cb272dd0d35de13d26e9cdc0e38e7c5bce953fb2d0bd6e879f";
const H2 = "0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9";
const R = (o: Partial<Readiness>): Readiness => ({ ready: false, verified: null, reviewed: false, high_findings: 0, reasons: [], head_revision: "abcdef1234567890", ...o });

describe("seal geometry", () => {
  it("is a pure function of the hash: same hash same seal, different hashes differ", () => {
    expect(sealGeometry(H1)).toEqual(sealGeometry(H1));
    expect(sealGeometry(H1).edge).not.toBe(sealGeometry(H2).edge);
    expect(sealGeometry(H1.toUpperCase())).toEqual(sealGeometry(H1));
  });
  it("always draws a finite, closed shape with 6 to 12 lobes, even for bad input", () => {
    for (const h of [H1, H2, "", null, undefined, "zzzz", "ab", "0".repeat(64), "f".repeat(64)]) {
      const g = sealGeometry(h as string | null);
      expect(g.lobes).toBeGreaterThanOrEqual(6);
      expect(g.lobes).toBeLessThanOrEqual(12);
      expect(g.edge.startsWith("M") && g.edge.endsWith("Z")).toBe(true);
      expect(`${g.edge} ${g.crack}`).not.toMatch(/NaN|Infinity|undefined/);
      expect(g.dots.length).toBeGreaterThanOrEqual(3);
      expect(g.dots.length).toBeLessThanOrEqual(6);
    }
  });
  it("reads hex bytes and fills in the rest deterministically", () => {
    expect(hashBytes("0aff", 3)).toEqual([10, 255, (2 * 37 + 11) % 256]);
    expect(hashBytes("not hex", 4)).toEqual(hashBytes("", 4));
  });
});

describe("what a seal is allowed to claim", () => {
  it("rings are counted only from checks that passed", () => {
    expect(sealStrength({ approved: true, tests: true, review: true })).toBe(3);
    expect(sealStrength({ approved: true, tests: false, review: null })).toBe(1);
    expect(sealStrength({ approved: null, tests: null, review: null })).toBe(0);
  });
  it("hollow until something is verified, cracked when a check fails, ready only when AIOS says so", () => {
    expect(sealState(null, { approved: null, tests: null, review: null })).toBe("hollow");
    expect(sealState(false, { approved: true, tests: false, review: null })).toBe("cracked");
    expect(sealState(false, { approved: true, tests: true, review: false })).toBe("cracked");
    expect(sealState(true, { approved: true, tests: true, review: null })).toBe("ready");
    expect(sealState(false, { approved: true, tests: true, review: null })).toBe("cracked");   // verdict wins over optimism
  });
  it("is built from the AIOS verdict and the review of the SAME revision", () => {
    const ready = sealFor(R({ ready: true, verified: true, reviewed: true }), 0, "abcdef1234567890");
    expect(ready).toMatchObject({ state: "ready", strength: 3 });
    expect(ready.label).toContain("revision abcdef12");
    expect(ready.label).toContain("3 of 3 checks");
    const lazy = sealFor(R({ ready: false, verified: true, reviewed: true, high_findings: 1 }), 1, "abcdef1234567890");
    expect(lazy.state).toBe("cracked");
    expect(lazy.checks).toEqual({ approved: true, tests: true, review: false });
    expect(lazy.label).toContain("independent review found a high-severity problem");
    const stale = sealFor(R({ ready: true, verified: true, reviewed: false }), null, "abcdef1234567890");
    expect(stale.checks.review).toBeNull();                                                    // a review of an older revision earns no ring
    expect(stale.strength).toBe(2);
    const none = sealFor(R({ head_revision: null }), null, null);
    expect(none.state).toBe("hollow");
    expect(none.label).toContain("revision none");
    expect(none.label).toContain("0 of 3 checks");
  });
});
