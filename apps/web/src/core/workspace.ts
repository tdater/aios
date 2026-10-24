import { Store } from "./connection";
import { KV, readJson, writeJson } from "./storage";

/** Obsidian-style open "documents". Only detail routes (a note, a run, an approval...) become tabs. */
export interface Tab { href: string; title: string; kind: string }
export interface WorkspaceState { tabs: Tab[] }
const MAX_TABS = 12;
const KEY = "aios.workspace.v1.";

export interface RouteLike { tab: string; sub?: string; id?: string }

const KIND_LABEL: Record<string, string> = { runs: "Run", knowledge: "Note", projects: "Project", inbox: "Review", graph: "Graph" };

export function hrefFor(r: RouteLike): string {
  return `#/${[r.tab, r.sub, r.id].filter(Boolean).map((s) => encodeURIComponent(s as string)).join("/")}`;
}
/** A readable placeholder title until the screen reports the real one. */
export function defaultTitle(r: RouteLike): string {
  if (r.tab === "graph") return "Graph view";
  const label = KIND_LABEL[r.tab] ?? r.tab;
  const short = (r.id ?? "").replace(/^[a-z]+_/, "").slice(0, 8);
  return short ? `${label} ${short}` : label;
}
export const isDocumentRoute = (r: RouteLike) => !!r.id || r.tab === "graph";

export class Workspace {
  readonly store: Store<WorkspaceState>;
  constructor(private kv: KV, private partition: string) {
    const saved = readJson<WorkspaceState>(kv, KEY + partition, { tabs: [] });
    this.store = new Store<WorkspaceState>({
      tabs: (saved.tabs ?? []).filter((t) => t && typeof t.href === "string" && t.href.startsWith("#/") && typeof t.title === "string")
        .map((t) => ({ href: t.href, title: t.title.slice(0, 80), kind: String(t.kind ?? "") })).slice(0, MAX_TABS),
    });
  }
  private commit(tabs: Tab[]) {
    this.store.set({ tabs });
    writeJson(this.kv, KEY + this.partition, { tabs });
  }
  /** Open (or focus) a document. Evicts the oldest tab beyond the limit. */
  visit(r: RouteLike, title?: string): void {
    if (!isDocumentRoute(r)) return;
    const href = hrefFor(r);
    const tabs = this.store.get().tabs;
    const existing = tabs.find((t) => t.href === href);
    if (existing) {
      if (title && existing.title !== title) this.setTitle(href, title);
      return;
    }
    const next = [...tabs, { href, title: (title ?? defaultTitle(r)).slice(0, 80), kind: r.tab }];
    this.commit(next.length > MAX_TABS ? next.slice(next.length - MAX_TABS) : next);
  }
  setTitle(href: string, title: string): void {
    const t = title.trim().slice(0, 80);
    if (!t) return;
    const tabs = this.store.get().tabs;
    if (!tabs.some((x) => x.href === href && x.title !== t)) return;
    this.commit(tabs.map((x) => (x.href === href ? { ...x, title: t } : x)));
  }
  /** Close a tab; returns the href to show next (neighbour), or null when none are left. */
  close(href: string, activeHref?: string): string | null {
    const tabs = this.store.get().tabs;
    const i = tabs.findIndex((t) => t.href === href);
    if (i < 0) return activeHref ?? null;
    const rest = tabs.filter((t) => t.href !== href);
    this.commit(rest);
    if (activeHref && activeHref !== href) return activeHref;
    return rest.length ? rest[Math.min(i, rest.length - 1)].href : null;
  }
  closeOthers(href: string): void {
    this.commit(this.store.get().tabs.filter((t) => t.href === href));
  }
  closeAll(): void {
    this.commit([]);
  }
  /** Cycle: +1 next, -1 previous. */
  neighbour(activeHref: string, dir: 1 | -1): string | null {
    const tabs = this.store.get().tabs;
    if (!tabs.length) return null;
    const i = tabs.findIndex((t) => t.href === activeHref);
    return tabs[(i + dir + tabs.length) % tabs.length].href;
  }
}
