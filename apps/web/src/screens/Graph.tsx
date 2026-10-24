import { useEffect, useMemo, useState } from "react";
import { filterGraph, matchNodes, neighborhood } from "../core/graph";
import { GraphData, GraphNode } from "../core/types";
import { useApp } from "../ui/Context";
import { GraphView, LEGEND, colorFor } from "../ui/GraphView";
import { go, useLoad } from "../ui/hooks";
import { Icon } from "../ui/icons";
import { Btn, Empty, ErrorBox, Loading } from "../ui/kit";
import { knowledgeQuery } from "../ui/uiState";
import { useTabTitle } from "../ui/useTabTitle";
import { newNoteTitle } from "./knowledge/vaultContext";

const KINDS = ["memory", "project", "unresolved", "tag", "candidate"] as const;

export function openNode(n: GraphNode) {
  if (n.kind === "memory") go({ tab: "knowledge", id: n.id });
  else if (n.kind === "project") go({ tab: "projects", id: n.id.replace(/^project:/, "") });
  else if (n.kind === "candidate") go({ tab: "inbox", sub: "candidate", id: n.id.replace(/^cand:/, "") });
  else if (n.kind === "tag") { knowledgeQuery.set(n.label); go({ tab: "knowledge" }); }
  else { newNoteTitle.set(n.label); go({ tab: "knowledge", id: "new" }); }
}

export function GraphScreen({ id }: { id?: string }) {
  const { client } = useApp();
  const [tags, setTags] = useState(false);
  const [cands, setCands] = useState(false);
  const [ghosts, setGhosts] = useState(true);
  const [orphans, setOrphans] = useState(true);
  const [labels, setLabels] = useState(true);
  const [depth, setDepth] = useState(2);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"graph" | "list">("graph");
  const [fit, setFit] = useState(0);
  const [relayout, setRelayout] = useState(0);
  const g = useLoad(() => client.get<GraphData>("/graph", { query: { tags, candidates: cands, unresolved: ghosts, limit: 400 } }), [client, tags, cands, ghosts]);
  useEffect(() => { setSelected(null); }, [id]);

  const full = g.data;
  const local = useMemo(() => (full && id ? neighborhood(full, id, depth) : null), [full, id, depth]);
  const shown = useMemo<GraphData | null>(() => {
    const base = local ?? full;
    return base ? filterGraph(base, { orphans: orphans || !!local, kinds: new Set(KINDS) }) : null;
  }, [local, full, orphans]);
  const highlight = useMemo(() => (shown ? matchNodes(shown.nodes, q) : null), [shown, q]);
  const byId = useMemo(() => new Map((full?.nodes ?? []).map((n) => [n.id, n])), [full]);
  const sel = selected ? byId.get(selected) ?? null : null;
  const focus = id ? byId.get(id) : null;
  useTabTitle(id ? `Graph: ${focus?.label ?? "…"}` : "Graph view");
  const palette = { accent: "var(--accent)" };
  void palette;

  const neighbors = useMemo(() => {
    if (!sel || !full) return [] as GraphNode[];
    const ids = new Set<string>();
    full.edges.forEach((e) => { if (e.source === sel.id) ids.add(e.target); if (e.target === sel.id) ids.add(e.source); });
    return full.nodes.filter((n) => ids.has(n.id)).sort((a, b) => b.degree - a.degree);
  }, [sel, full]);

  return (
    <div className="graphpage">
      <div className="graphbar" role="toolbar" aria-label="Graph controls">
        <strong style={{ marginRight: 4 }}>{id ? `Local graph${focus ? `: ${focus.label}` : ""}` : "Graph"}</strong>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Highlight…" aria-label="Highlight matching notes" style={{ maxWidth: 180, minHeight: 32 }} />
        <span className="grow" />
        <button className={`iconbtn ${mode === "graph" ? "on" : ""}`} aria-pressed={mode === "graph"} title="Graph view" onClick={() => setMode("graph")}><Icon name="graph" /><span className="sr">Graph view</span></button>
        <button className={`iconbtn ${mode === "list" ? "on" : ""}`} aria-pressed={mode === "list"} title="List view (accessible)" onClick={() => setMode("list")}><Icon name="list" /><span className="sr">List view</span></button>
        <button className="iconbtn" title="Fit to screen (F)" onClick={() => setFit((n) => n + 1)}><Icon name="maximize" /><span className="sr">Fit to screen</span></button>
        <button className="iconbtn" title="Re-run layout" onClick={() => setRelayout((n) => n + 1)}><Icon name="refresh" /><span className="sr">Re-run layout</span></button>
        <details style={{ position: "relative" }}>
          <summary className="iconbtn" aria-label="Graph filters" title="Filters" style={{ listStyle: "none" }}><Icon name="settings" /></summary>
          <div className="card" style={{ position: "absolute", right: 0, top: 38, zIndex: 20, width: 260, boxShadow: "var(--shadow)" }}>
            <label className="check"><input type="checkbox" checked={tags} onChange={(e) => setTags(e.target.checked)} /> Show tags</label>
            <label className="check"><input type="checkbox" checked={cands} onChange={(e) => setCands(e.target.checked)} /> Show proposals</label>
            <label className="check"><input type="checkbox" checked={ghosts} onChange={(e) => setGhosts(e.target.checked)} /> Show not-yet-created notes</label>
            <label className="check"><input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} disabled={!!id} /> Show orphans (no links)</label>
            <label className="check"><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Show labels</label>
            {id && <label className="field"><span>Depth: {depth}</span><input type="range" min={1} max={4} value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="Neighbourhood depth" /></label>}
          </div>
        </details>
        {id && <Btn kind="ghost" onClick={() => go({ tab: "graph" })}>Whole graph</Btn>}
      </div>
      {g.error && !full ? <div style={{ padding: 14 }}><ErrorBox msg={g.error} code={g.errorCode} /></div>
        : g.loading && !full ? <div style={{ padding: 14 }}><Loading what="Loading graph" /></div>
          : !shown || shown.nodes.length === 0 ? <div style={{ padding: 14 }}><Empty>{id && !focus ? "That note is not in the graph (it may have been forgotten)." : "Nothing to graph yet. Notes appear here as you create them and link them with [[wiki links]]."}</Empty></div>
            : mode === "list" ? (
              <div className="graphlist">
                <p className="muted small">{shown.nodes.length} nodes · {shown.edges.length} connections{full?.truncated ? " · showing the best-connected 400" : ""}</p>
                <ul className="cards">{[...shown.nodes].sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label)).map((n) => (
                  <li key={n.id}><div className="card-static row" style={{ justifyContent: "space-between" }}>
                    <span><strong>{n.label}</strong> <span className="muted small">{n.kind === "memory" ? n.type : n.kind} · {n.degree} connection{n.degree === 1 ? "" : "s"}</span></span>
                    <span className="row"><Btn kind="ghost" onClick={() => openNode(n)}>Open</Btn>{n.kind === "memory" && <Btn kind="ghost" onClick={() => go({ tab: "graph", id: n.id })}>Neighbourhood</Btn>}</span>
                  </div></li>))}</ul>
              </div>
            ) : (
              <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                <GraphView data={shown} selectedId={selected} focusId={id ?? null} highlight={highlight} showLabels={labels} onSelect={setSelected} onOpen={openNode}
                  ariaLabel={id ? `Neighbourhood graph of ${focus?.label ?? "the note"}` : "Knowledge graph"} fitSignal={fit} relayoutSignal={relayout} />
                <div className="graphlegend" aria-hidden="true">
                  {LEGEND.filter((l) => l.key.startsWith("type:") || shown.nodes.some((n) => (n.kind === l.key))).map((l) => (
                    <span key={l.key}><i style={{ background: colorFor(l.key, { accent: "var(--accent)", info: "var(--info)", warn: "var(--warn)", ok: "var(--ok)", text: "var(--text)", faint: "var(--faint)", muted: "var(--muted)" }) }} />{l.label}</span>))}
                </div>
                {sel && (
                  <div className="graphinfo" role="dialog" aria-label={`Details for ${sel.label}`}>
                    <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}><strong style={{ overflowWrap: "anywhere" }}>{sel.label}</strong>
                      <button className="iconbtn" style={{ minWidth: 28, minHeight: 28 }} aria-label="Close details" onClick={() => setSelected(null)}><Icon name="x" size={14} /></button></div>
                    <div className="muted small" style={{ margin: "2px 0 8px" }}>{sel.kind === "memory" ? `${sel.type} · ${sel.status}` : sel.kind} · {sel.degree} connection{sel.degree === 1 ? "" : "s"}</div>
                    <div className="row" style={{ justifyContent: "flex-start" }}>
                      <Btn onClick={() => openNode(sel)}>Open</Btn>
                      {sel.kind === "memory" && <Btn kind="ghost" onClick={() => go({ tab: "graph", id: sel.id })}>Neighbourhood</Btn>}
                    </div>
                    {neighbors.length > 0 && <><h3 style={{ marginTop: 10 }}>Connected</h3><ul className="linklist">{neighbors.slice(0, 8).map((n) => <li key={n.id}><button onClick={() => setSelected(n.id)}>{n.label}</button></li>)}</ul></>}
                  </div>
                )}
              </div>
            )}
    </div>
  );
}
