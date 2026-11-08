import { describe, expect, it } from "vitest";
import { bridgeLayout, looksLikeTv, nextArea } from "./layout";
import { MAX_PARALLAX_PX, parallaxOffset } from "./parallax";
import { WARP_MS, WARP_REDUCED_MS, warpPhase, warpPlan } from "./warp";
import { alertItems, opsItems, summary } from "./panelData";
import { UObject } from "../core/scene";

const o = (id: string, type: UObject["type"], tone: UObject["state"]["tone"], text = "x", meta?: Record<string, unknown>): UObject => ({ id, type, region: "control", name: id, job: "", state: { tone, text }, meta });

describe("layout", () => {
  it("picks phone under 600px, tv when asked, desktop otherwise", () => {
    expect(bridgeLayout(599, false)).toBe("phone");
    expect(bridgeLayout(600, false)).toBe("desktop");
    expect(bridgeLayout(300, true)).toBe("tv");
  });
  it("recognises TV user agents", () => {
    expect(looksLikeTv("Mozilla/5.0 (Linux; Android 11; AFTMM Build) SmartTV")).toBe(true);
    expect(looksLikeTv("Mozilla/5.0 (Windows NT 10.0) Chrome/120")).toBe(false);
  });
  it("moves between panels deterministically on desktop and stops at edges", () => {
    expect(nextArea("ops", "right", "desktop")).toBe("holo");
    expect(nextArea("holo", "right", "desktop")).toBe("alerts");
    expect(nextArea("alerts", "right", "desktop")).toBe("alerts");
    expect(nextArea("ops", "left", "desktop")).toBe("ops");
    expect(nextArea("holo", "down", "desktop")).toBe("today");
    expect(nextArea("today", "up", "desktop")).toBe("holo");
  });
  it("is one column on a phone", () => {
    expect(nextArea("alerts", "down", "phone")).toBe("holo");
    expect(nextArea("today", "down", "phone")).toBe("today");
    expect(nextArea("holo", "left", "phone")).toBe("holo");
  });
});

describe("parallax", () => {
  it("is zero when disabled or non-finite", () => {
    expect(parallaxOffset(1, 1, 1, false)).toEqual({ x: 0, y: 0 });
    expect(parallaxOffset(NaN, 0, 1, true)).toEqual({ x: 0, y: 0 });
  });
  it("is clamped to the maximum", () => {
    expect(Math.abs(parallaxOffset(50, -50, 5, true).x)).toBeLessThanOrEqual(MAX_PARALLAX_PX);
    expect(parallaxOffset(0, 0, 1, true)).toEqual({ x: 0, y: 0 });
  });
});

describe("warp", () => {
  it("swaps the destination before the trip ends and is 1.5s (0.25s reduced)", () => {
    const p = warpPlan(false), r = warpPlan(true);
    expect(p.total).toBe(WARP_MS); expect(p.swapAt).toBeLessThan(p.total);
    expect(r.total).toBe(WARP_REDUCED_MS);
  });
  it("moves through phases and ends idle", () => {
    expect(warpPhase(0, false)).toBe("charge");
    expect(warpPhase(500, false)).toBe("streak");
    expect(warpPhase(1200, false)).toBe("arrive");
    expect(warpPhase(WARP_MS, false)).toBe("idle");
    expect(warpPhase(-1, false)).toBe("idle");
  });
  it("never streaks when reduced", () => {
    for (let t = 0; t < WARP_REDUCED_MS; t += 10) expect(warpPhase(t, true)).not.toBe("streak");
  });
});

describe("panel data", () => {
  it("lists alerts worst first and ignores calm objects", () => {
    const items = alertItems([o("comet:approvals", "comet", "warn", "2 waiting", { count: 2 }), o("comet:blocked", "comet", "bad", "1 stuck", { count: 1 }), o("planet:claude", "planet", "ok"), o("comet:review", "comet", "ok", "none", { count: 0 })]);
    expect(items.map((i) => i.id)).toEqual(["comet:blocked", "comet:approvals"]);
  });
  it("returns no alerts when everything is calm", () => { expect(alertItems([o("planet:claude", "planet", "ok")])).toEqual([]); });
  it("lists jobs before systems", () => {
    const items = opsItems([o("home:engine", "module", "ok"), o("shuttle:r1", "shuttle", "info", "running")]);
    expect(items.map((i) => i.kind)).toEqual(["job", "system"]);
  });
  it("summarises in one line", () => {
    expect(summary([o("shuttle:r1", "shuttle", "info"), o("comet:approvals", "comet", "warn", "w", { count: 3 })])).toBe("1 job running · 3 waiting for you");
    expect(summary([])).toBe("0 jobs running · nothing waiting for you");
  });
});
