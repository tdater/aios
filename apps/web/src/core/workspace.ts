import { Store } from "./connection";
import { KV, readJson, writeJson } from "./storage";

/** Obsidian-style open "documents". Only detail routes (a note, a run, an approval...) become tabs. */
export interface Tab { href: string; title: string; kind: string; pinned?: boolean }
export interface WorkspaceState { tabs: Tab[] }
const MAX_TABS = 12;
const KEY = "aios.workspace.v1.";

export interface RouteLike { tab: string; sub?: string; id?: string }

const KIND_LABEL: Record<string, string> = { runs: "Run", knowledge: "Note", projects: "Project", inbox: "Review", graph: "Graph", work: "Chat" };

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
export const isDocumentRoute = (r: RouteLike) => (!!r.id && r.tab !== "settings") || r.tab === "graph";   // #/settings/history is a section anchor, not a document

/** Over the limit, drop the oldest unpinned tabs first (pinned ones only go if everything is pinned). */
function evict(tabs: Tab[]): Tab[] {
  let out = tabs;
  while (out.length > MAX_TABS) {
    const i = out.findIndex((t) => !t.pinned);
    out = out.filter((_, j) => j !== (i < 0 ? 0 : i));
  }
  return out;
}

export class Workspace {
  readonly store: Store<WorkspaceState>;
  constructor(private kv: KV, private partition: string) {
    const saved = readJson<WorkspaceState>(kv, KEY + partition, { tabs: [] });
    this.store = new Store<WorkspaceState>({
      tabs: (saved.tabs ?? []).filter((t) => t && typeof t.href === "string" && t.href.startsWith("#/") && typeof t.title === "string")
        .map((t) => ({ href: t.href, title: t.title.slice(0, 80), kind: String(t.kind ?? ""), ...(t.pinned === true ? { pinned: true } : {}) })).slice(0, MAX_TABS),
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
    this.commit(evict(next));
  }
  /** Pinned tabs sit first, survive "close others/all" and are never evicted by the tab limit. */
  togglePin(href: string): boolean {
    const tabs = this.store.get().tabs;
    const t = tabs.find((x) => x.href === href);
    if (!t) return false;
    const pinned = !t.pinned;
    const flipped = tabs.map((x) => (x.href === href ? (pinned ? { ...x, pinned: true } : { href: x.href, title: x.title, kind: x.kind }) : x));
    this.commit([...flipped.filter((x) => x.pinned), ...flipped.filter((x) => !x.pinned)]);
    return pinned;
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
    this.commit(this.store.get().tabs.filter((t) => t.href === href || t.pinned));
  }
  closeAll(): void {
    this.commit(this.store.get().tabs.filter((t) => t.pinned));
  }
  /** Cycle: +1 next, -1 previous. */
  neighbour(activeHref: string, dir: 1 | -1): string | null {
    const tabs = this.store.get().tabs;
    if (!tabs.length) return null;
    const i = tabs.findIndex((t) => t.href === activeHref);
    return tabs[(i + dir + tabs.length) % tabs.length].href;
  }
}
