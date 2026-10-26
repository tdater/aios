import { Store } from "../core/connection";
import { readJson, writeJson, LocalKV } from "../core/storage";

// Small cross-component UI state. Nothing here is secret or server data.
export const paletteStore = new Store<{ open: boolean; query: string }>({ open: false, query: "" });
export const openPalette = (query = "") => paletteStore.set({ open: true, query });
export const closePalette = () => paletteStore.set({ open: false, query: "" });

export const helpStore = new Store<boolean>(false);

/** The on-screen tour: open or closed, and which step. Whether it was ever finished is remembered in settings. */
export const tourStore = new Store<{ open: boolean; step: number }>({ open: false, step: 0 });
export const openTour = (step = 0) => tourStore.set({ open: true, step });
export const closeTour = () => tourStore.set({ open: false, step: 0 });

/** Query string handed to the Knowledge screen (palette tag picks, clicks on #tags, etc.). */
export const knowledgeQuery = new Store<string>("");

export interface NoteStats { words: number; links: number }
export const noteStats = new Store<NoteStats | null>(null);

interface LayoutPrefs { explorer: boolean }
const KEY = "aios.layout.v1";
const kv = new LocalKV();
export const layoutPrefs = new Store<LayoutPrefs>({ explorer: readJson<Partial<LayoutPrefs>>(kv, KEY, {}).explorer !== false });
export const setExplorer = (open: boolean) => {
  layoutPrefs.set({ ...layoutPrefs.get(), explorer: open });
  writeJson(kv, KEY, layoutPrefs.get());
};

/** Counts for the ribbon badge and status bar (null until the first successful poll). */
export interface Summary { approvals: number; running: number; blocked: number; candidates: number }
export const summaryStore = new Store<Summary | null>(null);

export const toastStore = new Store<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function toast(msg: string, ms = 2200) {
  toastStore.set(msg);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastStore.set(null), ms);
}
