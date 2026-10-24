import { useEffect, useMemo, useRef, useState } from "react";
import { AiosClient } from "../core/client";
import { Paged, Project, Run } from "../core/types";
import { hrefFor } from "../core/workspace";
import { useApp } from "./Context";
import { go, useStore } from "./hooks";
import { Icon, IconName } from "./icons";
import { GroupResult, PItem, flatten, paletteResults } from "./paletteLogic";
import { closePalette, knowledgeQuery, paletteStore } from "./uiState";

interface NoteRow { id: string; title: string; tags: string[]; type: string; status: string; excerpt?: string }
interface Index { notes: NoteRow[]; projects: Project[]; runs: Run[]; tags: { tag: string; count: number }[] }
let cache: { at: number; key: string; index: Index } | null = null;

async function loadIndex(client: AiosClient, partition: string): Promise<Index> {
  if (cache && cache.key === partition && Date.now() - cache.at < 45_000) return cache.index;
  const [notes, projects, runs, tags] = await Promise.all([
    client.get<Paged<NoteRow>>("/memories", { query: { limit: 200 } }),
    client.get<Paged<Project>>("/projects", { query: { limit: 100 } }),
    client.get<Paged<Run>>("/runs", { query: { limit: 25 } }),
    client.get<{ items: { tag: string; count: number }[] }>("/memories/tags"),
  ]);
  const index = { notes: notes.items, projects: projects.items, runs: runs.items, tags: tags.items };
  cache = { at: Date.now(), key: partition, index };
  return index;
}
export const invalidatePaletteIndex = () => { cache = null; };

const GO: { id: string; label: string; icon: IconName; route: { tab: "home" | "projects" | "runs" | "inbox" | "knowledge" | "graph" | "settings" } }[] = [
  { id: "go-home", label: "Home", icon: "home", route: { tab: "home" } }, { id: "go-projects", label: "Projects", icon: "folder", route: { tab: "projects" } },
  { id: "go-runs", label: "Runs", icon: "play", route: { tab: "runs" } }, { id: "go-inbox", label: "Inbox", icon: "inbox", route: { tab: "inbox" } },
  { id: "go-knowledge", label: "Knowledge vault", icon: "book", route: { tab: "knowledge" } }, { id: "go-graph", label: "Graph view", icon: "graph", route: { tab: "graph" } },
  { id: "go-settings", label: "Settings", icon: "settings", route: { tab: "settings" } },
];
const COMMANDS: { id: string; label: string; icon: IconName; keywords?: string }[] = [
  { id: "capture", label: "Quick capture an idea", icon: "plus", keywords: "new note task" },
  { id: "daily", label: "Open today's daily note", icon: "calendar", keywords: "journal today" },
  { id: "new-note", label: "Create a new note", icon: "edit", keywords: "write memory" },
  { id: "approvals", label: "Review pending approvals", icon: "shield", keywords: "inbox" },
  { id: "theme", label: "Cycle colour theme", icon: "moon", keywords: "dark light appearance" },
  { id: "explorer", label: "Toggle vault explorer", icon: "sidebar", keywords: "sidebar files" },
  { id: "tabs", label: "Toggle tab strip", icon: "columns" },
  { id: "pin-tab", label: "Pin or unpin current tab", icon: "pin", keywords: "keep" },
  { id: "close-tab", label: "Close current tab", icon: "x" },
  { id: "history", label: "Review imported history", icon: "history", keywords: "sessions sources" },
  { id: "pair", label: "Pair another device", icon: "link", keywords: "phone qr code" },
  { id: "help", label: "Show keyboard shortcuts", icon: "keyboard" },
  { id: "refresh", label: "Refresh search index", icon: "clock" },
  { id: "signout", label: "Sign out this device", icon: "x" },
];

function Highlight({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const set = new Set(indices);
  const parts: { s: string; hit: boolean }[] = [];
  [...text].forEach((ch, i) => {                                 // merge runs so the accessible name stays one piece of text
    const hit = set.has(i), last = parts[parts.length - 1];
    if (last && last.hit === hit) last.s += ch; else parts.push({ s: ch, hit });
  });
  return <>{parts.map((p, i) => (p.hit ? <mark key={i}>{p.s}</mark> : p.s))}</>;
}

export function Palette({ commands }: { commands: Record<string, () => void> }) {
  const app = useApp();
  const st = useStore(paletteStore);
  if (!st.open) return null;
  return <PaletteDialog key="dlg" initial={st.query} commands={commands} app={app} />;
}

function PaletteDialog({ initial, commands, app }: { initial: string; commands: Record<string, () => void>; app: ReturnType<typeof useApp> }) {
  const { client, partition, workspace } = app;
  const [q, setQ] = useState(initial);
  const [sel, setSel] = useState(0);
  const [index, setIndex] = useState<Index | null>(cache && cache.key === partition ? cache.index : null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [fts, setFts] = useState<NoteRow[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const tabs = useStore(workspace.store).tabs;

  useEffect(() => {
    input.current?.focus();
    loadIndex(client, partition).then(setIndex).catch((e) => setLoadErr(e instanceof Error ? e.message : String(e)));
    const o = opener.current as HTMLElement | null;
    return () => o?.focus?.();                                   // give focus back to whatever opened the palette
  }, [client, partition]);

  useEffect(() => {                                              // full-text search in note bodies (debounced)
    const plain = q.replace(/^[>#/]/, "").trim();
    if (q.startsWith(">") || q.startsWith("#") || plain.length < 3) { setFts([]); return; }
    let live = true;
    const t = setTimeout(() => {
      client.get<{ items: NoteRow[] }>("/memories", { query: { q: plain, limit: 8 } }).then((r) => live && setFts(r.items)).catch(() => live && setFts([]));
    }, 220);
    return () => { live = false; clearTimeout(t); };
  }, [q, client]);

  const items: PItem[] = useMemo(() => {
    const out: PItem[] = [];
    for (const t of tabs) out.push({ id: `tab:${t.href}`, group: "Open tabs", label: t.title, hint: t.kind, icon: "file", action: { type: "route", route: routeFromHref(t.href) } });
    const seen = new Set<string>();
    for (const n of [...(index?.notes ?? []), ...fts]) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push({ id: `note:${n.id}`, group: "Notes", label: n.title, hint: n.type, icon: "file",
        keywords: `${(n.tags ?? []).map((t) => `#${t}`).join(" ")} ${n.excerpt ?? ""}`, action: { type: "route", route: { tab: "knowledge", id: n.id } } });
    }
    for (const p of index?.projects ?? []) out.push({ id: `prj:${p.id}`, group: "Projects", label: p.name, icon: "folder", action: { type: "route", route: { tab: "projects", id: p.id } } });
    for (const r of index?.runs ?? []) out.push({ id: `run:${r.id}`, group: "Runs", label: r.task_title, hint: r.display_state.replace(/_/g, " "), icon: "play", action: { type: "route", route: { tab: "runs", id: r.id } } });
    for (const t of index?.tags ?? []) out.push({ id: `tag:${t.tag}`, group: "Tags", label: `#${t.tag}`, hint: `${t.count}`, icon: "tag", action: { type: "tag", tag: t.tag } });
    for (const g of GO) out.push({ id: g.id, group: "Go to", label: g.label, icon: g.icon, action: { type: "route", route: g.route } });
    for (const c of COMMANDS) out.push({ id: `cmd:${c.id}`, group: "Commands", label: c.label, icon: c.icon, keywords: c.keywords, action: { type: "command", id: c.id } });
    return out;
  }, [index, fts, tabs]);

  const groups: GroupResult[] = useMemo(() => paletteResults(q, items), [q, items]);
  const flat = useMemo(() => flatten(groups), [groups]);
  useEffect(() => setSel(0), [q]);
  useEffect(() => { document.getElementById(`pal-opt-${sel}`)?.scrollIntoView?.({ block: "nearest" }); }, [sel]);

  const run = (item: PItem | undefined) => {
    if (!item) {
      const text = q.replace(/^[>#/]/, "").trim();
      if (text) { knowledgeQuery.set(text); closePalette(); go({ tab: "knowledge" }); }
      return;
    }
    closePalette();
    const a = item.action;
    if (a.type === "route") go(a.route);
    else if (a.type === "tag") { knowledgeQuery.set(`#${a.tag}`); go({ tab: "knowledge" }); }
    else commands[a.id]?.();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); closePalette(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (flat.length ? (s + 1) % flat.length : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (flat.length ? (s - 1 + flat.length) % flat.length : 0)); }
    else if (e.key === "Home") { e.preventDefault(); setSel(0); }
    else if (e.key === "End") { e.preventDefault(); setSel(Math.max(0, flat.length - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); run(flat[sel]); }
    else if (e.key === "Tab") e.preventDefault();               // keep focus trapped on the input
  };

  let n = -1;
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closePalette(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey}>
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find notes, projects, runs, or type > for commands, # for tags"
          role="combobox" aria-expanded="true" aria-controls="pal-list" aria-activedescendant={flat.length ? `pal-opt-${sel}` : undefined} aria-label="Search" autoComplete="off" spellCheck={false} />
        <ul id="pal-list" role="listbox" aria-label="Results">
          {groups.map((g) => (
            <li key={g.group} role="presentation">
              <div className="grp" role="presentation">{g.group}</div>
              <ul role="presentation" style={{ padding: 0 }}>
                {g.entries.map((e) => {
                  n++;
                  const idx = n;
                  return (
                    <li key={e.item.id} id={`pal-opt-${idx}`} role="option" aria-selected={idx === sel} className="opt"
                      onMouseMove={() => setSel(idx)} onClick={() => run(e.item)}>
                      <Icon name={e.item.icon} /><span className="t"><Highlight text={e.item.label} indices={e.indices} /></span>
                      {e.item.hint && <span className="h">{e.item.hint}</span>}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {!groups.length && <li role="presentation" className="empty" style={{ margin: 8 }}>{q.trim() ? <>No matches. Press <kbd>Enter</kbd> to search the vault for “{q.replace(/^[>#/]/, "").trim()}”.</> : "Nothing to show yet."}</li>}
        </ul>
        <footer>
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span>
          <span>{loadErr ? `Index unavailable (${loadErr}); commands still work` : !index ? "Loading index…" : `${index.notes.length} notes indexed`}</span>
        </footer>
      </div>
    </div>
  );
}

function routeFromHref(href: string) {
  const parts = href.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const tab = (["home", "projects", "runs", "inbox", "knowledge", "graph", "settings"] as const).find((t) => t === parts[0]) ?? "home";
  return tab === "inbox" && parts[2] ? { tab, sub: parts[1], id: parts[2] } : { tab, id: parts[1] };
}
export { hrefFor };
