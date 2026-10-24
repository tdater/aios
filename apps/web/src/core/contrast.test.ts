import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./theme";

/** Reads the real stylesheet so a token change that breaks legibility fails the build. WCAG 2.1 AA: 4.5:1 text, 3:1 UI. */
const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf-8");

function decls(selector: string): Record<string, string> {
  const i = css.indexOf(`${selector} {`);
  if (i < 0) throw new Error(`no block for ${selector}`);
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)].map((m) => [m[1], m[2].length === 4 ? `#${[...m[2].slice(1)].map((c) => c + c).join("")}` : m[2]]));
}
const dark = decls(":root");
const light = decls(":root:not([data-theme])");
const THEMES: Record<string, Record<string, string>> = {
  "system (dark)": dark,
  "system (light)": { ...dark, ...light },
  vault: dark,
  light: { ...dark, ...decls(':root[data-theme="light"]') },
  midnight: { ...dark, ...decls(':root[data-theme="midnight"]') },
  paper: { ...dark, ...decls(':root[data-theme="paper"]') },
  contrast: { ...dark, ...decls(':root[data-theme="contrast"]') },
};

describe.each(Object.entries(THEMES))("contrast: %s", (_name, t) => {
  const surfaces = ["bg", "bg2", "panel", "panel2"];
  it.each(["text", "muted", "faint"])("%s text is at least 4.5:1 on every surface", (fg) => {
    for (const s of surfaces) expect(contrastRatio(t[fg], t[s]), `${fg} on ${s}`).toBeGreaterThanOrEqual(4.5);
  });
  it.each(["ok", "warn", "bad", "info"])("%s status colour is at least 4.5:1 on panel and bg", (c) => {
    for (const s of ["bg", "panel"]) expect(contrastRatio(t[c], t[s]), `${c} on ${s}`).toBeGreaterThanOrEqual(4.5);
  });
  it("accent is a visible UI colour (3:1) and its button text is readable (4.5:1)", () => {
    expect(contrastRatio(t.accent, t.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(t["accent-ink"], t.accent)).toBeGreaterThanOrEqual(4.5);
  });
  it("borders are visible enough to see a control's edge (3:1) in the high-contrast theme only", () => {
    if (_name === "contrast") expect(contrastRatio(t.line, t.bg)).toBeGreaterThanOrEqual(7);
  });
});
