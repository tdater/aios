import { KV, readJson, writeJson } from "./storage";
import { Store } from "./connection";

export type ThemeMode = "system" | "dark" | "light" | "midnight" | "paper" | "contrast";
export const THEME_MODES: { id: ThemeMode; label: string; hint: string }[] = [
  { id: "system", label: "System", hint: "Follow your device" },
  { id: "dark", label: "Vault", hint: "Dark slate" },
  { id: "midnight", label: "Midnight", hint: "True black" },
  { id: "light", label: "Daylight", hint: "Light" },
  { id: "paper", label: "Paper", hint: "Warm light" },
  { id: "contrast", label: "High contrast", hint: "Maximum legibility" },
];
export const ACCENTS: { id: string; label: string; hex: string }[] = [
  { id: "violet", label: "Violet", hex: "#8b7cf6" },
  { id: "blue", label: "Blue", hex: "#5aa9ff" },
  { id: "teal", label: "Teal", hex: "#2dd4bf" },
  { id: "green", label: "Green", hex: "#5fd08a" },
  { id: "amber", label: "Amber", hex: "#f0b84f" },
  { id: "rose", label: "Rose", hex: "#f472b6" },
];

export interface Settings {
  theme: ThemeMode;
  accent: string;                        // "default" or a #rrggbb colour
  fontSize: number;                      // px, 14-20
  readableLine: boolean;                 // limit note text to a comfortable line length
  noteFont: "sans" | "serif";
  tabs: boolean;                         // desktop tab strip
  statusBar: boolean;
  reduceMotion: "system" | "on";
  cacheEnabled: boolean;                 // opt-in: cache non-secret summaries for offline viewing
  draftPolicy: "manual" | "ask_on_reconnect";   // there is deliberately no "auto upload"
  mode: "simple" | "standard" | "power";  // which sections the menu lists (nothing is removed)
  density: "comfortable" | "compact";
  hiddenNav: string[];                   // sections the person switched off inside their mode
}
const KEY = "aios.settings.v1";
export const DEFAULT_SETTINGS: Settings = {
  theme: "system", accent: "default", fontSize: 16, readableLine: true, noteFont: "sans", tabs: true, statusBar: true,
  reduceMotion: "system", cacheEnabled: false, draftPolicy: "ask_on_reconnect",
  mode: "power", density: "comfortable", hiddenNav: [],   // existing users keep the full menu; new users are offered Simple on Home
};

/** Merge stored values over defaults, discarding anything invalid (settings come from localStorage: treat as untrusted input). */
export function sanitizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
  const size = typeof r.fontSize === "number" && isFinite(r.fontSize) ? Math.min(20, Math.max(14, Math.round(r.fontSize))) : d.fontSize;
  const accent = typeof r.accent === "string" && (r.accent === "default" || /^#[0-9a-fA-F]{6}$/.test(r.accent)) ? r.accent : d.accent;
  return {
    theme: pick(r.theme, THEME_MODES.map((t) => t.id), d.theme),
    accent, fontSize: size,
    readableLine: typeof r.readableLine === "boolean" ? r.readableLine : d.readableLine,
    noteFont: pick(r.noteFont, ["sans", "serif"] as const, d.noteFont),
    tabs: typeof r.tabs === "boolean" ? r.tabs : d.tabs,
    statusBar: typeof r.statusBar === "boolean" ? r.statusBar : d.statusBar,
    reduceMotion: pick(r.reduceMotion, ["system", "on"] as const, d.reduceMotion),
    cacheEnabled: typeof r.cacheEnabled === "boolean" ? r.cacheEnabled : d.cacheEnabled,
    draftPolicy: pick(r.draftPolicy, ["manual", "ask_on_reconnect"] as const, d.draftPolicy),
    mode: pick(r.mode, ["simple", "standard", "power"] as const, d.mode),
    density: pick(r.density, ["comfortable", "compact"] as const, d.density),
    hiddenNav: Array.isArray(r.hiddenNav) ? [...new Set(r.hiddenNav.filter((x): x is string => typeof x === "string" && /^[a-z]{3,12}$/.test(x) && x !== "home" && x !== "settings"))].slice(0, 12) : d.hiddenNav,
  };
}

export function createSettingsStore(kv: KV) {
  const store = new Store<Settings>(sanitizeSettings(readJson<Partial<Settings>>(kv, KEY, {})));
  return {
    store,
    update(patch: Partial<Settings>) {
      const next = sanitizeSettings({ ...store.get(), ...patch });
      writeJson(kv, KEY, next);
      store.set(next);
    },
  };
}
