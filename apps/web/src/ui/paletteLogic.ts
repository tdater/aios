import { Ranked, rank } from "../core/fuzzy";
import type { IconName } from "./icons";
import type { Route } from "./hooks";

export type Group = "Open tabs" | "Notes" | "Projects" | "Runs" | "Tags" | "Go to" | "Commands";
export type PAction = { type: "route"; route: Route } | { type: "command"; id: string } | { type: "tag"; tag: string };
export interface PItem { id: string; group: Group; label: string; hint?: string; icon: IconName; keywords?: string; action: PAction }
export interface GroupResult { group: Group; entries: Ranked<PItem>[] }

const ORDER: Group[] = ["Open tabs", "Notes", "Projects", "Runs", "Tags", "Go to", "Commands"];

/** Mode prefixes (as in Obsidian): ">" commands only, "#" tags only, "/" notes only. Otherwise everything, grouped. */
export function paletteResults(query: string, items: PItem[], perGroup = 7): GroupResult[] {
  const raw = query.replace(/^\s+/, "");
  const mode = raw[0] === ">" ? "commands" : raw[0] === "#" ? "tags" : raw[0] === "/" ? "notes" : "all";
  const q = mode === "all" ? raw : raw.slice(1);
  const pool = items.filter((i) => (mode === "commands" ? i.group === "Commands" : mode === "tags" ? i.group === "Tags" : mode === "notes" ? i.group === "Notes" : true));
  if (!q.trim()) {
    if (mode !== "all") return [{ group: pool[0]?.group ?? "Commands", entries: pool.slice(0, 30).map((item) => ({ item, score: 0, indices: [] })) }].filter((g) => g.entries.length);
    const quiet: Group[] = ["Open tabs", "Go to", "Commands"];        // empty query: no giant lists of notes/tags, just the useful starting points
    return quiet.map((g) => ({ group: g, entries: pool.filter((i) => i.group === g).slice(0, g === "Commands" ? 6 : 8).map((item) => ({ item, score: 0, indices: [] })) })).filter((g) => g.entries.length);
  }
  const out: GroupResult[] = [];
  for (const g of ORDER) {
    if (mode === "all" && g === "Tags") continue;                       // tags only appear with the "#" prefix
    const entries = rank(q, pool.filter((i) => i.group === g), (i) => `${i.label} ${i.keywords ?? ""}`, perGroup)
      .map((r) => ({ ...r, indices: r.indices.filter((ix) => ix < r.item.label.length) }));       // highlight only inside the visible label
    if (entries.length) out.push({ group: g, entries });
  }
  return out;
}

/** Flatten for keyboard navigation. */
export const flatten = (gs: GroupResult[]): PItem[] => gs.flatMap((g) => g.entries.map((e) => e.item));
