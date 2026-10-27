/** Deterministic force-directed layout (no dependencies). Same input + seed => same positions, so it is testable and reproducible.
 *  Forces: pairwise repulsion, edge springs, gentle gravity to the centre. O(n²) per step: fine for the <=400 nodes the API returns. */
export interface LayoutNode { id: string; x: number; y: number; vx: number; vy: number; r: number; fixed: boolean }
export interface LayoutEdge { source: string; target: string }
export interface LayoutOptions { seed?: number; spring?: number; rest?: number; charge?: number; gravity?: number; damping?: number }

/** mulberry32: tiny seeded PRNG. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

export class Layout {
  nodes: LayoutNode[];
  private index = new Map<string, number>();
  private links: [number, number][] = [];
  private o: Required<LayoutOptions>;
  alpha = 1;

  constructor(nodes: { id: string; degree?: number }[], edges: LayoutEdge[], opts: LayoutOptions = {}) {
    this.o = { seed: 7, spring: 0.05, rest: 70, charge: 900, gravity: 0.018, damping: 0.82, ...opts };
    const rnd = prng(this.o.seed);
    const n = Math.max(1, nodes.length);
    this.nodes = nodes.map((nd, i) => {
      const angle = (i / n) * Math.PI * 2 + (hash(nd.id) % 1000) / 1000;       // spread on a spiral: stable for a given id/order
      const rad = 30 + Math.sqrt(i + 1) * 28 + rnd() * 10;
      return { id: nd.id, x: Math.cos(angle) * rad, y: Math.sin(angle) * rad, vx: 0, vy: 0, r: 4 + Math.sqrt(nd.degree ?? 0) * 2.2, fixed: false };
    });
    this.nodes.forEach((nd, i) => this.index.set(nd.id, i));
    const seen = new Set<string>();
    for (const e of edges) {
      const a = this.index.get(e.source), b = this.index.get(e.target);
      if (a === undefined || b === undefined || a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;                                              // duplicate/parallel edges pull once
      seen.add(key);
      this.links.push([a, b]);
    }
  }

  get(id: string): LayoutNode | undefined { const i = this.index.get(id); return i === undefined ? undefined : this.nodes[i]; }

  /** One simulation step. Returns total kinetic energy (0 when settled). */
  step(): number {
    const { nodes, links, o } = this;
    const a = this.alpha;
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const q = nodes[j];
        let dx = p.x - q.x, dy = p.y - q.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = ((i * 31 + j) % 7) - 3 || 1; dy = ((i + j * 17) % 5) - 2 || 1; d2 = dx * dx + dy * dy; }   // deterministic nudge for coincident nodes
        const d = Math.sqrt(d2);
        const f = (o.charge * a) / (d2 + 60);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        if (!p.fixed) { p.vx += fx; p.vy += fy; }
        if (!q.fixed) { q.vx -= fx; q.vy -= fy; }
      }
    }
    for (const [ai, bi] of links) {
      const p = nodes[ai], q = nodes[bi];
      const dx = q.x - p.x, dy = q.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - o.rest - p.r - q.r) * o.spring * a;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      if (!p.fixed) { p.vx += fx; p.vy += fy; }
      if (!q.fixed) { q.vx -= fx; q.vy -= fy; }
    }
    let energy = 0;
    for (const p of nodes) {
      if (p.fixed) { p.vx = p.vy = 0; continue; }
      p.vx = (p.vx - p.x * o.gravity * a) * o.damping;
      p.vy = (p.vy - p.y * o.gravity * a) * o.damping;
      p.x += p.vx; p.y += p.vy;
      energy += p.vx * p.vx + p.vy * p.vy;
    }
    this.alpha = Math.max(0.02, this.alpha * 0.985);
    return energy;
  }

  /** Run to (near) rest without animating: used for reduced motion, first paint and tests. */
  settle(maxSteps = 280): void {
    for (let i = 0; i < maxSteps; i++) { if (this.step() < 0.02 * this.nodes.length && i > 60) break; }
    this.alpha = 0.02;
  }
  reheat(a = 0.5) { this.alpha = Math.max(this.alpha, a); }
  /** Put nodes at fixed positions (for the radial layout). Nodes not in the map keep where they are. */
  pin(pos: Map<string, { x: number; y: number }>): void {
    for (const n of this.nodes) { const p = pos.get(n.id); if (p) { n.x = p.x; n.y = p.y; n.vx = n.vy = 0; n.fixed = true; } }
    this.alpha = 0.02;
  }

  bounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    if (!this.nodes.length) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.nodes) { minX = Math.min(minX, n.x - n.r); minY = Math.min(minY, n.y - n.r); maxX = Math.max(maxX, n.x + n.r); maxY = Math.max(maxY, n.y + n.r); }
    return { minX, minY, maxX, maxY };
  }
  /** Node under a point in layout coordinates (topmost = smallest distance), or null. */
  hit(x: number, y: number, slop = 4): LayoutNode | null {
    let best: LayoutNode | null = null, bd = Infinity;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d <= n.r + slop && d < bd) { best = n; bd = d; }
    }
    return best;
  }
}

/** Radial mind-map positions: the centre in the middle, its direct neighbours on an inner ring, their neighbours on a second ring, everything
 *  else on an outer ring. Same input, same output. Rings are spaced so labels have room. */
export function radialPositions(nodeIds: string[], edges: LayoutEdge[], centerId: string, ringGap = 130): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const ids = new Set(nodeIds);
  if (!ids.has(centerId)) return out;
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
    (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e.source);
  }
  const depth = new Map<string, number>([[centerId, 0]]);
  const queue = [centerId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of [...(adj.get(cur) ?? [])].sort()) if (!depth.has(nb)) { depth.set(nb, Math.min(2, depth.get(cur)! + 1)); queue.push(nb); }
  }
  const rings: string[][] = [[], [], [], []];                                      // 0 centre, 1 inner, 2 outer, 3 not connected to the centre
  for (const id of [...nodeIds].sort()) rings[depth.has(id) ? depth.get(id)! : 3].push(id);
  rings.forEach((ring, d) => {
    if (d === 0) { out.set(centerId, { x: 0, y: 0 }); return; }
    const radius = Math.max(ringGap * d, (ring.length * 34) / (2 * Math.PI));        // grow a crowded ring so nodes do not overlap
    ring.forEach((id, i) => { const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2; out.set(id, { x: Math.cos(a) * radius, y: Math.sin(a) * radius }); });
  });
  return out;
}
