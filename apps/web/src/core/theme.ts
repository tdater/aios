import { Settings } from "./settings";

/** Relative luminance of a #rrggbb colour (WCAG). */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Text colour that stays readable on top of an accent-coloured button. */
export function inkFor(accentHex: string): string {
  return contrastRatio(accentHex, "#0b0b12") >= contrastRatio(accentHex, "#ffffff") ? "#0b0b12" : "#ffffff";
}

/** Apply appearance settings to the document root. Pure DOM, no storage. */
export function applyTheme(s: Settings, root: HTMLElement = document.documentElement): void {
  if (s.theme === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = s.theme;
  if (s.accent !== "default" && /^#[0-9a-fA-F]{6}$/.test(s.accent)) {
    root.style.setProperty("--accent", s.accent);
    root.style.setProperty("--accent-ink", inkFor(s.accent));
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-ink");
  }
  root.style.setProperty("--fs", `${s.fontSize}px`);
  root.dataset.readable = s.readableLine ? "on" : "off";
  root.dataset.notefont = s.noteFont;
  if (s.reduceMotion === "on") root.dataset.motion = "reduce";
  else root.removeAttribute("data-motion");
}
