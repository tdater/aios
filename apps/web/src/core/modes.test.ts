import { describe, expect, it } from "vitest";
import { ALWAYS_SHOWN, MODE_TABS, hiddenReason, hideable, navLabel, tabVisible } from "./modes";
import { DEFAULT_SETTINGS, sanitizeSettings } from "./settings";

const S = (o = {}) => ({ mode: "standard" as const, hiddenNav: [] as string[], ...o });

describe("modes", () => {
  it("each mode adds to the one before it and none removes Home or Settings", () => {
    expect(MODE_TABS.standard).toEqual(expect.arrayContaining(MODE_TABS.simple));
    expect(MODE_TABS.power).toEqual(expect.arrayContaining(MODE_TABS.standard));
    for (const m of ["simple", "standard", "power"] as const) for (const t of ALWAYS_SHOWN) expect(MODE_TABS[m]).toContain(t);
  });
  it("Simple hides projects, runs and the graph; Power shows them", () => {
    expect(["projects", "runs", "graph"].map((t) => tabVisible(S({ mode: "simple" }), t as never))).toEqual([false, false, false]);
    expect(["projects", "runs", "graph"].map((t) => tabVisible(S({ mode: "power" }), t as never))).toEqual([true, true, true]);
    expect(tabVisible(S(), "graph")).toBe(false);
  });
  it("Simple is four anchors plus Settings, and says what each is for", () => {
    expect(MODE_TABS.simple).toEqual(["home", "work", "knowledge", "inbox", "settings"]);
    expect(navLabel("simple", "work", "Workspace")).toBe("Missions");
    expect(navLabel("standard", "work", "Workspace")).toBe("Workspace");
    expect(navLabel("simple", "knowledge", "Knowledge")).toBe("Knowledge");
    expect(["ais", "insights"].map((t) => tabVisible(S({ mode: "simple" }), t as never))).toEqual([false, false]);
  });
  it("a person can switch sections off inside their mode, but never Home or Settings", () => {
    expect(tabVisible(S({ hiddenNav: ["runs"] }), "runs")).toBe(false);
    expect(tabVisible(S({ hiddenNav: ["home", "settings"] }), "home")).toBe(true);
    expect(hideable("simple")).not.toContain("home");
  });
  it("explains why something is hidden", () => {
    expect(hiddenReason(S({ mode: "simple" }), "runs")).toMatch(/Hidden in Simple mode/);
    expect(hiddenReason(S({ hiddenNav: ["runs"] }), "runs")).toMatch(/turned this section off/);
    expect(hiddenReason(S(), "work")).toBeNull();
  });
});

describe("settings sanitising for the new options", () => {
  it("keeps the full menu by default and rejects junk from storage", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ mode: "power", density: "comfortable", hiddenNav: [] });
    const s = sanitizeSettings({ mode: "root", density: 5, hiddenNav: ["runs", "runs", "home", "settings", 7, "<script>", "graph"] } as never);
    expect([s.mode, s.density, s.hiddenNav]).toEqual(["power", "comfortable", ["runs", "graph"]]);
    expect(sanitizeSettings({ mode: "simple", density: "compact" }).mode).toBe("simple");
  });
});
