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

/** Colour key for a node: notes by type, other kinds by kind. The renderer maps keys to theme colours. */
export function colorKey(n: GraphNode): string {
  return n.kind === "memory" ? `type:${n.type ?? "fact"}` : n.kind;
}
