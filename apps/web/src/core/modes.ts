import type { Settings } from "./settings";

// Simple / Standard / Power decide which sections the menu lists. Switching never deletes or disables anything:
// a hidden section is still reachable by link, the command palette, or by switching mode back.
export type Mode = "simple" | "standard" | "power";
export type Tab = "home" | "work" | "projects" | "runs" | "inbox" | "insights" | "ais" | "knowledge" | "graph" | "settings";
export const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "simple", label: "Simple", hint: "Home, Missions, what AIOS remembers, and things waiting for you" },
  { id: "standard", label: "Standard", hint: "Adds My AIs, Insights, projects and runs" },
  { id: "power", label: "Power", hint: "Everything, including the knowledge graph" },
];
const SIMPLE: Tab[] = ["home", "work", "knowledge", "inbox", "settings"];
const STANDARD: Tab[] = [...SIMPLE, "ais", "insights", "projects", "runs"];
export const MODE_TABS: Record<Mode, Tab[]> = { simple: SIMPLE, standard: STANDARD, power: [...STANDARD, "graph"] };
/** Home and Settings can never be hidden, so there is always a way back. */
export const ALWAYS_SHOWN: Tab[] = ["home", "settings"];

export const tabVisible = (s: Pick<Settings, "mode" | "hiddenNav">, tab: Tab): boolean =>
  ALWAYS_SHOWN.includes(tab) || (MODE_TABS[s.mode].includes(tab) && !s.hiddenNav.includes(tab));
/** Sections the person can switch off individually inside their mode. */
export const hideable = (mode: Mode): Tab[] => MODE_TABS[mode].filter((t) => !ALWAYS_SHOWN.includes(t));
export const hiddenReason = (s: Pick<Settings, "mode" | "hiddenNav">, tab: Tab): string | null =>
  tabVisible(s, tab) ? null : !MODE_TABS[s.mode].includes(tab) ? `Hidden in ${MODES.find((m) => m.id === s.mode)!.label} mode. Change the mode in Settings.` : "You turned this section off in Settings.";

/** Simple mode says what a section is for instead of what it is called inside. Other modes keep the plain names. */
const SIMPLE_LABELS: Partial<Record<Tab, string>> = { work: "Missions", inbox: "Inbox" };
export const navLabel = (mode: Mode, tab: Tab, fallback: string): string => (mode === "simple" ? SIMPLE_LABELS[tab] : undefined) ?? fallback;
