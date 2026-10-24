import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adjacency, colorKey, ColorMode, projectSlot } from "../core/graph";
import { Layout } from "../core/graphLayout";
import { GraphData, GraphNode } from "../core/types";

export interface GraphViewProps {
  data: GraphData;
  selectedId?: string | null;
  focusId?: string | null;
  highlight?: Set<string> | null;
  showLabels?: boolean;
  colorMode?: ColorMode;                   // colour notes by type (default) or by project
  visible?: Set<string> | null;            // time-lapse: only these nodes (and edges between them) are drawn; null = all
  compact?: boolean;                       // small static preview: no pan/zoom/drag, click opens
  onSelect?: (id: string | null) => void;
  onOpen?: (node: GraphNode) => void;
  ariaLabel: string;
  fitSignal?: number;                      // bump to refit the view
  relayoutSignal?: number;                 // bump to scramble and re-run the layout
  height?: number | string;
}

interface Pal { [k: string]: string }
function readPalette(): Pal {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string, fb: string) => s.getPropertyValue(n).trim() || fb;
  return {
    bg: v("--bg", "#14141b"), text: v("--text", "#e7e7f1"), muted: v("--muted", "#9b9bb3"), faint: v("--faint", "#6f6f8a"), line: v("--line2", "#44445e"),
    accent: v("--accent", "#8b7cf6"), ok: v("--ok", "#5fd0a0"), warn: v("--warn", "#e8b84f"), info: v("--info", "#6cb6ff"), bad: v("--bad", "#f2777f"),
  };
}
export const LEGEND: { key: string; label: string }[] = [
  { key: "type:preference", label: "Preference" }, { key: "type:fact", label: "Fact" }, { key: "type:decision", label: "Decision" }, { key: "type:lesson", label: "Lesson" },
  { key: "type:procedure", label: "Procedure" }, { key: "project", label: "Project" }, { key: "tag", label: "Tag" }, { key: "unresolved", label: "Not created" }, { key: "candidate", label: "Proposal" },
];
const PROJECT_COLORS = ["#8b7cf6", "#2dd4bf", "#f472b6", "#e8b84f", "#6cb6ff", "#5fd0a0", "#fb923c", "#a3e635"];
export const projectColor = (projectId: string) => PROJECT_COLORS[projectSlot(projectId, PROJECT_COLORS.length)];
export function colorFor(key: string, p: Pal): string {
  if (key.startsWith("proj:")) return key === "proj:none" ? p.muted : projectColor(key.slice(5));
  switch (key) {
    case "type:preference": return p.accent; case "type:fact": return p.info; case "type:decision": return p.warn; case "type:lesson": return p.ok;
    case "type:procedure": return "#f472b6"; case "project": return p.text; case "tag": return "#2dd4bf"; case "unresolved": return p.faint; case "candidate": return p.warn;
    default: return p.muted;
  }
}
const reduceMotion = () => matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduce";

export function GraphView(props: GraphViewProps) {
  const { data, selectedId, focusId, highlight, showLabels = true, compact = false, onSelect, onOpen, ariaLabel, fitSignal, relayoutSignal, height } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layout = useRef<Layout | null>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const raf = useRef<number | null>(null);
  const pal = useRef<Pal>(readPalette());
  const hoverRef = useRef<string | null>(null);
  const drag = useRef<{ id: string | null; moved: number; lastX: number; lastY: number; pointers: Map<number, { x: number; y: number }>; pinch: number } | null>(null);
  const [tip, setTip] = useState<{ label: string; x: number; y: number; sub: string } | null>(null);
  const [announce, setAnnounce] = useState("");
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes]);
  const adj = useMemo(() => adjacency(data.edges), [data.edges]);
  const propsRef = useRef(props);
  propsRef.current = props;

  const draw = useCallback(() => {
    const c = canvas.current, l = layout.current;
    if (!c || !l) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr } = size.current;
    const p = pal.current;
    const v = view.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2 + v.x, h / 2 + v.y);
    ctx.scale(v.k, v.k);
    const pr = propsRef.current;
    const active = pr.selectedId ?? pr.focusId ?? hoverRef.current;
    const near = active ? adj.get(active) ?? new Set<string>() : null;
    const hl = pr.highlight;
    const alphaOf = (id: string) => {
      if (hl && !hl.has(id)) return 0.12;
      if (active && id !== active && !near!.has(id)) return 0.16;
      return 1;
    };
    ctx.lineCap = "round";
    const vis = pr.visible;
    for (const e of data.edges) {
      const a = l.get(e.source), b = l.get(e.target);
      if (!a || !b || (vis && !(vis.has(e.source) && vis.has(e.target)))) continue;
      const hot = active && (e.source === active || e.target === active);
      ctx.globalAlpha = hot ? 0.9 : Math.min(alphaOf(e.source), alphaOf(e.target)) * (active ? 0.5 : 0.38);
      ctx.strokeStyle = hot ? p.accent : p.line;
      ctx.lineWidth = (hot ? 1.8 : 1) / Math.sqrt(v.k);
      ctx.setLineDash(e.kind === "supersedes" ? [5 / v.k, 4 / v.k] : e.kind === "tagged" ? [2 / v.k, 3 / v.k] : []);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.setLineDash([]);
    const labelSize = 12 / v.k;
    ctx.font = `${labelSize}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    for (const n of l.nodes) {
      const g = byId.get(n.id);
      if (!g || (vis && !vis.has(n.id))) continue;
      const key = colorKey(g, pr.colorMode);
      const col = colorFor(key, p);
      const sel = n.id === pr.selectedId, foc = n.id === pr.focusId;
      ctx.globalAlpha = alphaOf(n.id);
      const r = n.r + (sel || foc ? 3 : 0);
      ctx.beginPath();
      if (g.kind === "project") ctx.rect(n.x - r, n.y - r, r * 2, r * 2);
      else if (g.kind === "tag") { for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; ctx[i ? "lineTo" : "moveTo"](n.x + Math.cos(a) * (r + 1), n.y + Math.sin(a) * (r + 1)); } ctx.closePath(); }
      else ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      if (g.kind === "unresolved" || g.kind === "candidate") { ctx.strokeStyle = col; ctx.lineWidth = 1.6 / v.k; ctx.setLineDash([3 / v.k, 2 / v.k]); ctx.stroke(); ctx.setLineDash([]); }
      else { ctx.fillStyle = col; ctx.fill(); }
      if (g.status === "candidate" || g.status === "superseded") { ctx.strokeStyle = p.bg; ctx.lineWidth = 1.4 / v.k; ctx.stroke(); }
      if (sel || foc || n.id === hoverRef.current) { ctx.strokeStyle = p.text; ctx.lineWidth = 2 / v.k; ctx.beginPath(); ctx.arc(n.x, n.y, r + 3 / v.k + 1, 0, Math.PI * 2); ctx.stroke(); }
      const showLabel = pr.showLabels !== false && (pr.compact || sel || foc || n.id === hoverRef.current || (near && near.has(n.id)) || (hl && hl.has(n.id)) || v.k >= 1.1 || g.degree >= 3);
      if (showLabel) {
        const text = g.label.length > 34 ? `${g.label.slice(0, 33)}…` : g.label;
        ctx.lineWidth = 3.5 / v.k; ctx.strokeStyle = p.bg; ctx.lineJoin = "round"; ctx.strokeText(text, n.x, n.y + r + labelSize + 1 / v.k);
        ctx.fillStyle = sel || foc ? p.text : p.muted; ctx.fillText(text, n.x, n.y + r + labelSize + 1 / v.k);
      }
    }
    ctx.globalAlpha = 1;
  }, [data.edges, adj, byId]);

  const fit = useCallback(() => {
    const l = layout.current;
    const { w, h } = size.current;
    if (!l || !w || !h) return;
    const b = l.bounds();
    const bw = Math.max(40, b.maxX - b.minX), bh = Math.max(40, b.maxY - b.minY);
    const pad = propsRef.current.compact ? 36 : 70;
    const k = Math.min(propsRef.current.compact ? 1.6 : 3.2, Math.max(0.15, Math.min((w - pad) / bw, (h - pad) / bh)));
    view.current = { k, x: -((b.minX + b.maxX) / 2) * k, y: -((b.minY + b.maxY) / 2) * k };
    draw();
  }, [draw]);

  const kick = useCallback(() => {
    if (raf.current != null) return;
    const tick = () => {
      raf.current = null;
      const l = layout.current;
      if (!l) return;
      const dragging = !!drag.current?.id;
      let again = false;
      if (l.alpha > 0.021 || dragging) { l.step(); again = true; }
      draw();
      if (again) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [draw]);

  // (re)build the layout when the graph changes, keeping positions of nodes that survive (so filters feel continuous)
  useEffect(() => {
    const prev = new Map(layout.current?.nodes.map((n) => [n.id, [n.x, n.y] as const]));
    const l = new Layout(data.nodes, data.edges);
    let kept = 0;
    for (const n of l.nodes) { const p = prev.get(n.id); if (p) { n.x = p[0]; n.y = p[1]; kept++; } }
    layout.current = l;
    if (reduceMotion() || kept === 0 || compact) { l.settle(); fit(); } else { l.reheat(0.55); kick(); }
    return () => { if (raf.current != null) cancelAnimationFrame(raf.current); raf.current = null; };
  }, [data.nodes, data.edges, compact, fit, kick]);

  useEffect(() => { if (fitSignal) fit(); }, [fitSignal, fit]);
  useEffect(() => {
    if (!relayoutSignal || !layout.current) return;
    const l = new Layout(data.nodes, data.edges, { seed: 11 + relayoutSignal });
    layout.current = l;
    if (reduceMotion()) { l.settle(); fit(); } else { l.alpha = 1; kick(); fit(); }
  }, [relayoutSignal, data.nodes, data.edges, fit, kick]);
  useEffect(() => { draw(); }, [selectedId, focusId, highlight, showLabels, props.colorMode, props.visible, draw]);

  // size + theme observers
  useEffect(() => {
    const el = wrap.current, c = canvas.current;
    if (!el || !c) return;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
      const first = size.current.w === 0;
      size.current = { w, h, dpr };
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      if (first) fit(); else draw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const mo = new MutationObserver(() => { pal.current = readPalette(); draw(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [fit, draw]);

  const toLayout = (cx: number, cy: number) => {
    const r = canvas.current!.getBoundingClientRect();
    const { w, h } = size.current;
    return { x: (cx - r.left - w / 2 - view.current.x) / view.current.k, y: (cy - r.top - h / 2 - view.current.y) / view.current.k };
  };
  const nodeAt = (cx: number, cy: number) => {
    const p = toLayout(cx, cy), h = layout.current?.hit(p.x, p.y, 5 / view.current.k) ?? null;
    return h && propsRef.current.visible && !propsRef.current.visible.has(h.id) ? null : h;
  };
  const zoomAt = (cx: number, cy: number, factor: number) => {
    const v = view.current;
    const k = Math.min(5, Math.max(0.1, v.k * factor));
    const r = canvas.current!.getBoundingClientRect();
    const { w, h } = size.current;
    const mx = cx - r.left - w / 2, my = cy - r.top - h / 2;
    v.x = mx - ((mx - v.x) / v.k) * k; v.y = my - ((my - v.y) / v.k) * k; v.k = k;
    draw();
  };

  useEffect(() => {                                              // wheel needs a non-passive listener to stop page scroll
    const c = canvas.current;
    if (!c || compact) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (compact) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const d = drag.current ?? { id: null, moved: 0, lastX: e.clientX, lastY: e.clientY, pointers: new Map(), pinch: 0 };
    d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag.current = d;
    d.lastX = e.clientX; d.lastY = e.clientY; d.moved = 0;
    if (d.pointers.size === 1) {
      const n = nodeAt(e.clientX, e.clientY);
      if (n) { d.id = n.id; n.fixed = true; layout.current?.reheat(0.4); kick(); }
    } else if (d.pointers.size === 2) { const [a, b] = [...d.pointers.values()]; d.pinch = Math.hypot(a.x - b.x, a.y - b.y); d.id = null; }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d && d.pointers.has(e.pointerId)) {
      d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (d.pointers.size === 2) {
        const [a, b] = [...d.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (d.pinch) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / d.pinch);
        d.pinch = dist; d.moved += 10;
        return;
      }
      const dx = e.clientX - d.lastX, dy = e.clientY - d.lastY;
      d.moved += Math.abs(dx) + Math.abs(dy);
      d.lastX = e.clientX; d.lastY = e.clientY;
      if (d.id) { const n = layout.current?.get(d.id); if (n) { const p = toLayout(e.clientX, e.clientY); n.x = p.x; n.y = p.y; layout.current?.reheat(0.3); kick(); } }
      else { view.current.x += dx; view.current.y += dy; draw(); }
      return;
    }
    if (compact || e.pointerType === "touch") return;
    const n = nodeAt(e.clientX, e.clientY);
    const id = n?.id ?? null;
    if (id !== hoverRef.current) {
      hoverRef.current = id;
      canvas.current!.style.cursor = id ? "pointer" : "";
      const g = id ? byId.get(id) : null;
      const r = wrap.current!.getBoundingClientRect();
      setTip(g ? { label: g.label, sub: `${g.kind === "memory" ? g.type ?? "note" : g.kind} · ${g.degree} connection${g.degree === 1 ? "" : "s"}`, x: e.clientX - r.left, y: e.clientY - r.top } : null);
      draw();
    } else if (id) setTip((t) => (t ? { ...t, x: e.clientX - wrap.current!.getBoundingClientRect().left, y: e.clientY - wrap.current!.getBoundingClientRect().top } : t));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.pointers.delete(e.pointerId);
    if (d.pointers.size > 0) return;
    const wasClick = d.moved < 5;
    const id = d.id;
    if (id) { const n = layout.current?.get(id); if (n) n.fixed = false; }
    drag.current = null;
    if (wasClick) {
      const hit = id ?? nodeAt(e.clientX, e.clientY)?.id ?? null;
      onSelect?.(hit === selectedId ? null : hit);
      if (hit) setAnnounce(`${byId.get(hit)?.label ?? ""}, ${byId.get(hit)?.degree ?? 0} connections`);
    }
  };
  const onClickCompact = (e: React.MouseEvent) => {
    if (!compact) return;
    const n = nodeAt(e.clientX, e.clientY);
    if (n) { const g = byId.get(n.id); if (g) onOpen?.(g); }
  };
  const onDouble = (e: React.MouseEvent) => {
    if (compact) return;
    const n = nodeAt(e.clientX, e.clientY);
    const g = n ? byId.get(n.id) : null;
    if (g) onOpen?.(g);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const v = view.current;
    const step = 40;
    const sorted = [...data.nodes].sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
    const cycle = (dir: number) => { if (!sorted.length) return; const i = sorted.findIndex((n) => n.id === selectedId); const n = sorted[(i + dir + sorted.length) % sorted.length]; onSelect?.(n.id); setAnnounce(`${n.label}, ${n.degree} connections`); };
    switch (e.key) {
      case "+": case "=": zoomAt(size.current.w / 2 + canvas.current!.getBoundingClientRect().left, size.current.h / 2 + canvas.current!.getBoundingClientRect().top, 1.25); break;
      case "-": zoomAt(size.current.w / 2 + canvas.current!.getBoundingClientRect().left, size.current.h / 2 + canvas.current!.getBoundingClientRect().top, 0.8); break;
      case "ArrowLeft": v.x += step; draw(); break; case "ArrowRight": v.x -= step; draw(); break;
      case "ArrowUp": v.y += step; draw(); break; case "ArrowDown": v.y -= step; draw(); break;
      case "n": cycle(1); break; case "p": cycle(-1); break; case "f": fit(); break;
      case "Escape": onSelect?.(null); break;
      case "Enter": { const g = selectedId ? byId.get(selectedId) : null; if (g) onOpen?.(g); break; }
      default: return;
    }
    e.preventDefault();
  };

  return (
    <div ref={wrap} className="graphbody" style={height ? { height, minHeight: 0, flex: "none" } : undefined}>
      <canvas ref={canvas} tabIndex={compact ? -1 : 0} role="img" aria-label={`${ariaLabel}. ${data.nodes.length} nodes, ${data.edges.length} connections. Keyboard: N and P cycle nodes, Enter opens, plus and minus zoom, arrows pan, F fits.`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onPointerLeave={() => { if (hoverRef.current) { hoverRef.current = null; setTip(null); draw(); } }} onClick={onClickCompact} onDoubleClick={onDouble} onKeyDown={onKey}
        className={drag.current?.id ? "dragging" : undefined} />
      {tip && !compact && <div className="graphinfo" style={{ left: Math.min(tip.x + 14, (wrap.current?.clientWidth ?? 300) - 190), top: tip.y + 14, right: "auto", maxWidth: 200, padding: "6px 10px", pointerEvents: "none" }}><strong>{tip.label}</strong><div className="muted small">{tip.sub}</div></div>}
      <span className="sr" aria-live="polite">{announce}</span>
    </div>
  );
}
