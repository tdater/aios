import type { Settings } from "./settings";

// Simple / Standard / Power decide which sections the menu lists. Switching never deletes or disables anything:
// a hidden section is still reachable by link, the command palette, or by switching mode back.
export type Mode = "simple" | "standard" | "power";
export type Tab = "home" | "work" | "projects" | "runs" | "inbox" | "insights" | "ais" | "knowledge" | "graph" | "settings";
export const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "simple", label: "Simple", hint: "Home, chat, things waiting for you, what AIOS remembers" },
  { id: "standard", label: "Standard", hint: "Adds projects and runs" },
  { id: "power", label: "Power", hint: "Everything, including the knowledge graph" },
];
const SIMPLE: Tab[] = ["home", "work", "inbox", "ais", "insights", "knowledge", "settings"];
const STANDARD: Tab[] = [...SIMPLE, "projects", "runs"];
export const MODE_TABS: Record<Mode, Tab[]> = { simple: SIMPLE, standard: STANDARD, power: [...STANDARD, "graph"] };
/** Home and Settings can never be hidden, so there is always a way back. */
export const ALWAYS_SHOWN: Tab[] = ["home", "settings"];

export const tabVisible = (s: Pick<Settings, "mode" | "hiddenNav">, tab: Tab): boolean =>
  ALWAYS_SHOWN.includes(tab) || (MODE_TABS[s.mode].includes(tab) && !s.hiddenNav.includes(tab));
/** Sections the person can switch off individually inside their mode. */
export const hideable = (mode: Mode): Tab[] => MODE_TABS[mode].filter((t) => !ALWAYS_SHOWN.includes(t));
export const hiddenReason = (s: Pick<Settings, "mode" | "hiddenNav">, tab: Tab): string | null =>
  tabVisible(s, tab) ? null : !MODE_TABS[s.mode].includes(tab) ? `Hidden in ${MODES.find((m) => m.id === s.mode)!.label} mode. Change the mode in Settings.` : "You turned this section off in Settings.";
