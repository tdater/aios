import { describe, expect, it } from "vitest";
import { fuzzyMatch, rank } from "./fuzzy";
import { describeFilters, parseQuery, setTagFilter } from "./query";
import { DEFAULT_SETTINGS, createSettingsStore, sanitizeSettings } from "./settings";
import { MemoryKV } from "./storage";
import { applyTheme, contrastRatio, inkFor } from "./theme";

describe("settings sanitising (localStorage is untrusted input)", () => {
  it("falls back to defaults for junk and clamps ranges", () => {
    const s = sanitizeSettings({ theme: "neon" as never, accent: "javascript:alert(1)", fontSize: 999, noteFont: "comic" as never, tabs: "yes" as never });
    expect(s).toMatchObject({ theme: "system", accent: "default", fontSize: 20, noteFont: "sans", tabs: true });
    expect(sanitizeSettings({ fontSize: 3 }).fontSize).toBe(14);
    expect(sanitizeSettings({ fontSize: NaN }).fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
  it("accepts valid hex accents only and persists updates", () => {
    expect(sanitizeSettings({ accent: "#12abEF" }).accent).toBe("#12abEF");
    expect(sanitizeSettings({ accent: "#12abE" }).accent).toBe("default");
    expect(sanitizeSettings({ accent: "red; background:url(x)" }).accent).toBe("default");
    const kv = new MemoryKV();
    const st = createSettingsStore(kv);
    st.update({ theme: "paper", fontSize: 18 });
    expect(createSettingsStore(kv).store.get()).toMatchObject({ theme: "paper", fontSize: 18 });
  });
});

describe("theme application", () => {
  it("sets, overrides and clears the document state", () => {
    const root = document.createElement("html");
    applyTheme({ ...DEFAULT_SETTINGS, theme: "midnight", accent: "#ffcc00", fontSize: 18, noteFont: "serif", reduceMotion: "on" }, root);
    expect(root.dataset.theme).toBe("midnight");
    expect(root.style.getPropertyValue("--accent")).toBe("#ffcc00");
    expect(root.style.getPropertyValue("--accent-ink")).toBe("#0b0b12");     // dark text on a light accent
    expect(root.style.getPropertyValue("--fs")).toBe("18px");
    expect(root.dataset.notefont).toBe("serif");
    expect(root.dataset.motion).toBe("reduce");
    applyTheme(DEFAULT_SETTINGS, root);
    expect(root.dataset.theme).toBeUndefined();
    expect(root.style.getPropertyValue("--accent")).toBe("");
    expect(root.dataset.motion).toBeUndefined();
  });
  it("always picks a readable ink colour for any accent", () => {
    for (const hex of ["#8b7cf6", "#5aa9ff", "#2dd4bf", "#5fd08a", "#f0b84f", "#f472b6", "#000000", "#ffffff", "#123456", "#fedcba"]) {
      expect(contrastRatio(hex, inkFor(hex))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("fuzzy matching", () => {
  it("matches subsequences, rejects non-matches, ranks contiguous and prefix hits first", () => {
    expect(fuzzyMatch("gvc", "Gradle version catalog")).not.toBeNull();
    expect(fuzzyMatch("zzz", "Gradle")).toBeNull();
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, indices: [] });
    const r = rank("grad", ["Upgrade guide", "Gradle caching", "Go real fast and deliver"], (x) => x);
    expect(r[0].item).toBe("Gradle caching");
    expect(r.map((x) => x.item)).toContain("Upgrade guide");
  });
  it("returns highlight indices and prefers word-boundary matches", () => {
    const m = fuzzyMatch("bc", "build cache")!;
    expect(m.indices).toEqual([0, 6]);
    expect(fuzzyMatch("bc", "build cache")!.score).toBeGreaterThan(fuzzyMatch("bc", "abacus")!.score);
  });
  it("is case-insensitive and respects the limit", () => {
    expect(rank("ANDROID", ["android build"], (x) => x)).toHaveLength(1);
    expect(rank("a", Array.from({ length: 100 }, (_, i) => `a${i}`), (x) => x, 10)).toHaveLength(10);
  });
});

describe("search operators", () => {
  it("parses filters, bare #tags, phrases and reports unknown operators", () => {
    const p = parseQuery('gradle cache tag:#android type:lesson scope:project status:approved "build cache" #extra bogus:1 type:nope');
    expect(p).toMatchObject({ tag: "extra", type: "lesson", scope: "project", status: "approved" });
    expect(p.phrases).toEqual(["build cache"]);
    expect(p.text).toBe("gradle cache build cache bogus:1");            // not an operator: stays searchable text (think "12:30")
    expect(p.unknown).toEqual(["type:nope"]);                            // a known operator with an invalid value is surfaced, not dropped
    expect(parseQuery("path:foo").unknown).toEqual(["path:foo"]);        // recognised but unsupported operator is reported
    expect(describeFilters(p).map((f) => f.key)).toEqual(["tag", "type", "scope", "status"]);
  });
  it("adds, replaces and removes the tag filter while keeping what else the user typed", () => {
    expect(setTagFilter("gradle cache", "android")).toBe("gradle cache #android");
    expect(setTagFilter("gradle #old type:lesson", "new")).toBe("gradle type:lesson #new");
    expect(setTagFilter("gradle tag:#old", null)).toBe("gradle");
    expect(setTagFilter('"exact phrase" #a', null)).toBe('"exact phrase"');
    expect(setTagFilter("", null)).toBe("");
    expect(setTagFilter("issue#12 text", "x")).toBe("issue#12 text #x");     // '#' inside a word is not a tag token
  });
  it("treats an operator with no value as plain text and handles empty input", () => {
    expect(parseQuery("tag:").text).toBe("tag:");
    expect(parseQuery("   ")).toMatchObject({ text: "", phrases: [], unknown: [] });
  });
});
