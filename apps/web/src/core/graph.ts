import { GraphData, GraphEdge, GraphNode, NoteLinks } from "./types";
import { fuzzyMatch } from "./fuzzy";

/** Nodes within `depth` hops of `id` (undirected), with the edges among them. */
export function neighborhood(data: GraphData, id: string, depth: number): GraphData {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => { (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b); (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a); };
  data.edges.forEach((e) => link(e.source, e.target));
  const seen = new Set<string>(data.nodes.some((n) => n.id === id) ? [id] : []);
  let frontier = [...seen];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const f of frontier) for (const nb of adj.get(f) ?? []) if (!seen.has(nb)) { seen.add(nb); next.push(nb); }
    frontier = next;
  }
  return { nodes: data.nodes.filter((n) => seen.has(n.id)), edges: data.edges.filter((e) => seen.has(e.source) && seen.has(e.target)), truncated: false };
}

export interface GraphFilter { orphans: boolean; kinds: Set<GraphNode["kind"]> }
/** Hide orphans (degree 0) and/or whole node kinds; edges follow their endpoints. */
export function filterGraph(data: GraphData, f: GraphFilter): GraphData {
  const nodes = data.nodes.filter((n) => f.kinds.has(n.kind) && (f.orphans || n.degree > 0));
  const keep = new Set(nodes.map((n) => n.id));
  return { nodes, edges: data.edges.filter((e) => keep.has(e.source) && keep.has(e.target)), truncated: data.truncated };
}

/** Which nodes match the highlight box (fuzzy on the label). Empty query => null (no dimming). */
export function matchNodes(nodes: GraphNode[], query: string): Set<string> | null {
  const q = query.trim();
  if (!q) return null;
  return new Set(nodes.filter((n) => fuzzyMatch(q, n.label)).map((n) => n.id));
}

export function adjacency(edges: GraphEdge[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const e of edges) { (m.get(e.source) ?? m.set(e.source, new Set()).get(e.source)!).add(e.target); (m.get(e.target) ?? m.set(e.target, new Set()).get(e.target)!).add(e.source); }
  return m;
}

/** A tiny graph for the note side panel, built from the note's own link data (no extra request). */
export function localGraphFromLinks(centre: { id: string; title: string }, links: NoteLinks): GraphData {
  const nodes = new Map<string, GraphNode>([[centre.id, { id: centre.id, kind: "memory", label: centre.title, degree: 0 }]]);
  const edges: GraphEdge[] = [];
  for (const o of links.outgoing) { nodes.set(o.id, { id: o.id, kind: "memory", label: o.title, degree: 1 }); edges.push({ source: centre.id, target: o.id, kind: "link" }); }
  for (const b of links.backlinks) { nodes.set(b.id, { id: b.id, kind: "memory", label: b.title, degree: 1 }); edges.push({ source: b.id, target: centre.id, kind: "link" }); }
  for (const u of links.unresolved) { const gid = `ghost:${u.toLowerCase()}`; nodes.set(gid, { id: gid, kind: "unresolved", label: u, degree: 1 }); edges.push({ source: centre.id, target: gid, kind: "link" }); }
  nodes.get(centre.id)!.degree = edges.length;
  return { nodes: [...nodes.values()], edges, truncated: false };
}

export type ColorMode = "type" | "project";
/** Colour key for a node: notes by type (or by project), other kinds by kind. The renderer maps keys to theme colours. */
export function colorKey(n: GraphNode, mode: ColorMode = "type"): string {
  if (n.kind !== "memory") return n.kind;
  return mode === "project" ? `proj:${n.project_id ?? "none"}` : `type:${n.type ?? "fact"}`;
}

/** Stable colour slot for a project id (hash into a small palette so the same project always looks the same). */
export function projectSlot(projectId: string, slots: number): number {
  let h = 2166136261;
  for (const ch of projectId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h % slots;
}

/** Creation-time range of the notes in the graph (ms since epoch), or null when no note has a usable timestamp. */
export function timeRange(data: GraphData): [number, number] | null {
  const ts = data.nodes.map((n) => (n.created_at ? Date.parse(n.created_at) : NaN)).filter((t) => Number.isFinite(t));
  return ts.length ? [Math.min(...ts), Math.max(...ts)] : null;
}

/**
 * Time-lapse: ids visible at time `t`. A note appears once it exists; any other node (project, tag, not-yet-created
 * link, proposal) appears as soon as one of its neighbours does, so the graph grows the way the vault did.
 */
export function visibleAt(data: GraphData, t: number): Set<string> {
  const seen = new Set<string>();
  for (const n of data.nodes) {
    if (n.kind === "memory") { const c = n.created_at ? Date.parse(n.created_at) : NaN; if (!Number.isFinite(c) || c <= t) seen.add(n.id); }
  }
  const kind = new Map(data.nodes.map((n) => [n.id, n.kind]));
  const grown = new Set(seen);
  for (const e of data.edges) {
    for (const [a, b] of [[e.source, e.target], [e.target, e.source]] as const) {
      if (kind.has(a) && kind.get(a) !== "memory" && grown.has(b)) seen.add(a);
    }
  }
  return seen;
}
