import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { LocalKV, readJson, writeJson } from "../../core/storage";
import { describeFilters, parseQuery, setTagFilter } from "../../core/query";
import { Memory } from "../../core/types";
import { GroupBy, NoteRow, TagNode, buildTagTree, buildTree, filterNotes } from "../../core/vault";
import { useApp } from "../../ui/Context";
import { go, useStore } from "../../ui/hooks";
import { Icon } from "../../ui/icons";
import { Empty, ErrorBox, Loading } from "../../ui/kit";
import { knowledgeQuery, setExplorer } from "../../ui/uiState";
import { useVault } from "./vaultContext";

const kv = new LocalKV();
const KEY = "aios.explorer.v1";
interface Prefs { group: GroupBy; collapsed: string[]; tagsOpen: boolean }
const loadPrefs = (): Prefs => ({ group: "type", collapsed: [], tagsOpen: true, ...readJson<Partial<Prefs>>(kv, KEY, {}) });

type Hit = NoteRow & { excerpt?: string };

/** Search = Obsidian-style operators. Free text goes to the server's full-text search; filters apply on top. */
function useVaultSearch(query: string) {
  const { client } = useApp();
  const vault = useVault();
  const parsed = useMemo(() => parseQuery(query), [query]);
  const hasFilters = !!(parsed.tag || parsed.type || parsed.scope || parsed.status);
  const [remote, setRemote] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (parsed.text.length < 2) { setRemote(null); setErr(null); return; }
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      client.get<{ items: Hit[] }>("/memories", { query: { q: parsed.text, tag: parsed.tag, type: parsed.type, scope: parsed.scope, status: parsed.status, limit: 50 } })
        .then((r) => { if (live) { setRemote(r.items); setErr(null); } })
        .catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); })
        .finally(() => live && setBusy(false));
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [client, parsed.text, parsed.tag, parsed.type, parsed.scope, parsed.status]);
  const results: Hit[] | null = remote ?? (hasFilters && parsed.text.length < 2 ? filterNotes(vault.notes, parsed) : null);
  return { parsed, results, busy, err, active: parsed.text.length >= 2 || hasFilters };
}

function TagRow({ node, active, onPick, depth }: { node: TagNode; active: string | undefined; onPick: (t: string) => void; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  return (
    <li>
      <div style={{ display: "flex", alignItems: "center" }}>
        {node.children.length > 0 ? (
          <button className="iconbtn" style={{ minWidth: 22, minHeight: 22 }} aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`} aria-expanded={open} onClick={() => setOpen(!open)}>
            <Icon name="chevronRight" size={12} />
          </button>
        ) : <span style={{ width: 22 }} />}
        <button className="treerow" style={{ flex: 1 }} aria-pressed={active === node.full} aria-current={active === node.full ? "true" : undefined} onClick={() => onPick(node.full)}>
          <Icon name="tag" size={13} /><span className="lbl">{node.name}</span><span className="n">{node.count}</span>
        </button>
      </div>
      {open && node.children.length > 0 && <ul>{node.children.map((c) => <TagRow key={c.full} node={c} active={active} onPick={onPick} depth={depth + 1} />)}</ul>}
    </li>
  );
}

export function Explorer({ selectedId, variant = "side" }: { selectedId?: string; variant?: "side" | "page" }) {
  const vault = useVault();
  const { connected } = useApp();
  const storeQuery = useStore(knowledgeQuery);
  const [query, setQuery] = useState("");
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (storeQuery) { setQuery(storeQuery); knowledgeQuery.set(""); } }, [storeQuery]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const save = (p: Prefs) => { setPrefs(p); writeJson(kv, KEY, p); };
  const { parsed, results, busy, err, active } = useVaultSearch(query);
  const folders = useMemo(() => buildTree(vault.notes, prefs.group, vault.projectName), [vault.notes, prefs.group, vault.projectName]);
  const tagTree = useMemo(() => buildTagTree(vault.tags), [vault.tags]);
  const toggle = (key: string) => save({ ...prefs, collapsed: prefs.collapsed.includes(key) ? prefs.collapsed.filter((k) => k !== key) : [...prefs.collapsed, key] });
  const pickTag = (t: string) => setQuery((q) => setTagFilter(q, parseQuery(q).tag === t ? null : t));
  const open = (id: string) => go({ tab: "knowledge", id });
  const onTreeKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...(root.current?.querySelectorAll<HTMLElement>(".treerow") ?? [])];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };
  const allCollapsed = folders.length > 0 && folders.every((f) => prefs.collapsed.includes(f.key));

  const rows = (list: Hit[]) => (
    <ul className="tree">
      {list.map((n) => (
        <li key={n.id}>
          <button className="treerow" aria-current={n.id === selectedId ? "true" : undefined} onClick={() => open(n.id)} title={n.title}>
            <span className={`sdot ${n.status}`} aria-label={n.status} />
            <span className="lbl">{n.title}</span>
          </button>
          {n.excerpt && <div className="muted small" style={{ padding: "0 10px 6px 24px" }}>{n.excerpt.replace(/\[|\]/g, "")}</div>}
        </li>
      ))}
    </ul>
  );

  return (
    <aside className={`explorer ${variant === "page" ? "page" : ""}`} aria-label="Vault explorer" ref={root} onKeyDown={onTreeKey}>
      {variant === "page" && <h2 style={{ padding: "0 8px" }}>Knowledge</h2>}
      <div className="head" style={{ flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 140 }}>
          <input ref={input} type="search" aria-label="Search notes" placeholder="Search notes…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ minHeight: 34, paddingLeft: 30 }} />
          <span style={{ position: "absolute", left: 9, top: 9, color: "var(--faint)", pointerEvents: "none" }}><Icon name="search" size={15} /></span>
        </div>
        <button className="iconbtn" aria-label="New note" title="New note" disabled={!connected} onClick={() => go({ tab: "knowledge", id: "new" })}><Icon name="edit" /></button>
        {variant === "side" && <button className="iconbtn" aria-label="Hide explorer" title="Hide explorer (Ctrl \\)" onClick={() => setExplorer(false)}><Icon name="sidebar" /></button>}
      </div>
      <div className="head" style={{ gap: 4, padding: "4px 8px" }}>
        <label className="sr" htmlFor={`grp-${variant}`}>Group notes by</label>
        <select id={`grp-${variant}`} value={prefs.group} onChange={(e) => save({ ...prefs, group: e.target.value as GroupBy })} style={{ minHeight: 28, padding: "2px 8px", fontSize: ".82rem", flex: 1 }}>
          <option value="type">Group: type</option><option value="project">Group: project</option><option value="status">Group: status</option>
        </select>
        <button className="iconbtn" style={{ minWidth: 30, minHeight: 28 }} aria-label={allCollapsed ? "Expand all folders" : "Collapse all folders"} title={allCollapsed ? "Expand all" : "Collapse all"}
          onClick={() => save({ ...prefs, collapsed: allCollapsed ? [] : folders.map((f) => f.key) })}><Icon name={allCollapsed ? "chevronDown" : "chevronRight"} size={15} /></button>
      </div>
      <div className="scroll">
        {vault.error && <ErrorBox msg={vault.error} />}
        {parsed.unknown.length > 0 && <p className="muted small" style={{ padding: "0 8px" }}>Not understood: {parsed.unknown.join(", ")}</p>}
        {active && describeFilters(parsed).length > 0 && (
          <div className="chips" style={{ padding: "0 6px" }}>
            {describeFilters(parsed).map((f) => <span key={f.key} className="tagchip">{f.key}: {f.value}</span>)}
            <button className="link small" onClick={() => setQuery(parsed.text)}>clear filters</button>
          </div>
        )}
        {vault.loading ? <Loading what="Loading vault" /> : active ? (
          busy && !results ? <Loading what="Searching" /> : err ? <ErrorBox msg={err} /> : results && results.length ? (
            <>
              <p className="muted small" style={{ padding: "0 8px" }}>{results.length} result{results.length === 1 ? "" : "s"}</p>
              {rows(results)}
            </>
          ) : <Empty>No notes match.</Empty>
        ) : vault.notes.length === 0 ? <Empty>Your vault is empty. Create a note, or approve a proposal from the Inbox.</Empty> : (
          <ul className="tree" role="tree" aria-label="Notes">
            {folders.map((f) => {
              const closed = prefs.collapsed.includes(f.key);
              return (
                <li key={f.key} role="treeitem" aria-expanded={!closed}>
                  <button className="treerow folder" onClick={() => toggle(f.key)}>
                    <span className={`chev ${closed ? "" : "open"}`}><Icon name="chevronRight" size={13} /></span><Icon name="folder" size={14} /><span className="lbl">{f.label}</span><span className="n">{f.notes.length}</span>
                  </button>
                  {!closed && <div role="group">{rows(f.notes)}</div>}
                </li>
              );
            })}
          </ul>
        )}
        {tagTree.length > 0 && !active && (
          <>
            <button className="treerow folder" style={{ marginTop: 10 }} onClick={() => save({ ...prefs, tagsOpen: !prefs.tagsOpen })} aria-expanded={prefs.tagsOpen}>
              <span className={`chev ${prefs.tagsOpen ? "open" : ""}`}><Icon name="chevronRight" size={13} /></span><Icon name="tag" size={14} /><span className="lbl">Tags</span><span className="n">{vault.tags.length}</span>
            </button>
            {prefs.tagsOpen && <ul className="tree">{tagTree.map((t) => <TagRow key={t.full} node={t} active={parsed.tag} onPick={pickTag} depth={0} />)}</ul>}
          </>
        )}
      </div>
    </aside>
  );
}

export type { Memory };
