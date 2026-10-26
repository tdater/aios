import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { shapePath, starSummary } from "../core/sky";
import { Camera, FOCAL, Vec3, clamp, defaultCamera, ease, flyTo, layoutScene, lerpCamera, orbit, pan, posOf, project, projectScene, zoom } from "../core/space3d";
import { Universe } from "../core/types";
import { H, LEVEL_TEXT, W, layoutUniverse } from "../core/universe";
import { Selection, planetKind, planetLabel, starClass } from "./Universe";

const VIEW = { w: W, h: H, focal: FOCAL };
const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const key = (e: React.KeyboardEvent, fn: () => void) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } };

type Drawable = { depth: number; node: React.ReactNode };

/** The universe as a space you travel through. Drag to look around, scroll or pinch to move closer, click anything to fly to it. */
export function UniverseSpace({ u, sel, onSelect, onFlat }: { u: Universe; sel: Selection; onSelect: (s: Selection) => void; onFlat?: () => void }) {
  const gid = useId().replace(/[^A-Za-z0-9]/g, "");
  const scene = useMemo(() => layoutScene(u), [u]);
  const hud = useMemo(() => layoutUniverse(u).comets, [u]);
  const [cam, setCam] = useState<Camera>(defaultCamera);
  const camRef = useRef(cam);
  camRef.current = cam;
  const raf = useRef<number | null>(null);
  const [spin, setSpin] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; pan: boolean; el: Element } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);
  const justDragged = useRef(false);

  const stop = useCallback(() => { if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; } }, []);
  const set = useCallback((c: Camera) => { stop(); camRef.current = c; setCam(c); }, [stop]);
  /** Smoothly fly the camera to `to` (or jump, for people who prefer reduced motion). */
  const travel = useCallback((to: Camera, ms = 650) => {
    stop();
    if (reducedMotion() || typeof requestAnimationFrame !== "function") { camRef.current = to; setCam(to); return; }
    const from = camRef.current, t0 = performance.now();
    const step = (now: number) => {
      const t = clamp((now - t0) / ms, 0, 1), c = lerpCamera(from, to, ease(t));
      camRef.current = c; setCam(c);
      raf.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    raf.current = requestAnimationFrame(step);
  }, [stop]);
  useEffect(() => stop, [stop]);

  useEffect(() => {                                           // gentle drift while "Spin" is on; never when the person prefers calm
    if (!spin || reducedMotion() || typeof requestAnimationFrame !== "function") return;
    let last = performance.now(), id = 0;
    const tick = (now: number) => { if (!drag.current) { const c = orbit(camRef.current, (now - last) * 0.00018, 0); camRef.current = c; setCam(c); } last = now; id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [spin]);

  useEffect(() => {                                           // wheel needs a non-passive listener so the page does not scroll while you fly
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); set(zoom(camRef.current, Math.exp(e.deltaY * 0.0012))); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [set]);

  const go = (to: Selection | { kind: "cluster"; name: string }) => {
    const p = to ? posOf(scene, to as never) : null;
    if (p) travel(flyTo(camRef.current, p, to && to.kind === "core" ? 260 : to && to.kind === "cluster" ? 230 : to && to.kind === "planet" ? 150 : 130));
  };
  const choose = (s: Selection) => { onSelect(s); go(s); };

  // ---- pointer: drag to look around (shift or right button to slide), two fingers to pinch
  const down = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; pinch.current = Math.hypot(a.x - b.x, a.y - b.y); drag.current = null; return; }
    drag.current = { x: e.clientX, y: e.clientY, moved: false, pan: e.shiftKey || e.button === 2, el: e.currentTarget as Element };
  };
  const move = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 0) { set(zoom(camRef.current, pinch.current / d)); pinch.current = d; }
      justDragged.current = true;
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true; justDragged.current = true;
    try { d.el.setPointerCapture?.(e.pointerId); } catch { /* not supported */ }     // only once it is really a drag: capturing earlier would swallow the click on a planet or star
    d.x = e.clientX; d.y = e.clientY;
    set(d.pan ? pan(camRef.current, -dx * 0.9, dy * 0.9) : orbit(camRef.current, -dx * 0.008, dy * 0.008));
  };
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    drag.current = null;
    if (justDragged.current) setTimeout(() => { justDragged.current = false; }, 0);     // a drag must not also count as a click
  };
  const click = (s: Selection) => (e: React.MouseEvent) => { e.stopPropagation(); if (!justDragged.current) choose(s); };

  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === "ArrowLeft") set(orbit(camRef.current, -0.14, 0)); else if (k === "ArrowRight") set(orbit(camRef.current, 0.14, 0));
    else if (k === "ArrowUp") set(orbit(camRef.current, 0, -0.1)); else if (k === "ArrowDown") set(orbit(camRef.current, 0, 0.1));
    else if (k === "+" || k === "=") set(zoom(camRef.current, 0.8)); else if (k === "-" || k === "_") set(zoom(camRef.current, 1.25));
    else if (k === "0" || k === "Home") travel(defaultCamera());
    else if (k === "Escape") onSelect(null);
    else return;
    e.preventDefault();
  };

  const told = sel?.kind === "planet" ? u.ais.find((a) => a.provider === sel.provider)?.told ?? [] : [];
  const frame = useMemo(() => projectScene(scene, cam, VIEW, sel?.kind === "planet" ? sel.provider : undefined, told), [scene, cam, sel, told.join(",")]);   // eslint-disable-line react-hooks/exhaustive-deps
  const things: Drawable[] = [];
  for (const { item: p, x, y, scale, opacity, depth } of frame.planets) {
    const r = Math.max(6, p.r * scale * 1.4), isSel = sel?.kind === "planet" && sel.provider === p.ai.provider;
    things.push({ depth, node: (
      <g key={`p-${p.ai.provider}`} role="button" tabIndex={0} aria-pressed={isSel} aria-label={planetLabel(p.ai)} className={`planet ${planetKind(p.ai)}${isSel ? " sel" : ""}`} style={{ opacity }}
        onClick={click({ kind: "planet", provider: p.ai.provider })} onKeyDown={(e) => key(e, () => choose({ kind: "planet", provider: p.ai.provider }))}>
         <circle cx={x} cy={y} r={r} style={p.ai.provider === "claude" && p.ai.mode === "interactive" ? { fill: `url(#${gid}sun)` } : p.ai.provider === "claude" ? undefined : { fill: `url(#${gid}manual)` }} /><text x={x} y={y + r + 13} textAnchor="middle" className="plabel" style={{ fontSize: clamp(11 * scale * 1.5, 9, 17) }}>{p.ai.name}</text><title>{p.ai.name}</title>
      </g>) });
  }
  for (const { item: s, x, y, scale, opacity, depth } of frame.stars) {
    const isTold = told.includes(s.star.id), r = Math.max(3, s.r * scale * 1.6);
    things.push({ depth, node: (
      <g key={`s-${s.star.id}`} transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-pressed={sel?.kind === "star" && sel.id === s.star.id} aria-label={starSummary(s.star)}
        className={starClass({ state: s.star.state, hollow: s.star.hollow, id: s.star.id }, isTold, sel)}
        style={{ opacity: sel?.kind === "planet" && !isTold ? Math.min(opacity, 0.25) : Math.min(opacity, 0.35 + 0.65 * s.star.brightness) }}
        onClick={click({ kind: "star", id: s.star.id })} onKeyDown={(e) => key(e, () => choose({ kind: "star", id: s.star.id }))}>
        <path d={shapePath(s.star.type, r)} /><title>{starSummary(s.star)}</title>
      </g>) });
  }
  if (frame.core) {
    const { x, y, scale, depth } = frame.core, r = Math.max(7, 22 * scale);
    things.push({ depth, node: (
      <g key="core" role="button" tabIndex={0} className={`core${sel?.kind === "core" ? " sel" : ""}`} aria-label={`You: AIOS remembers ${u.you.approved} things about you`}
        onClick={click({ kind: "core" })} onKeyDown={(e) => key(e, () => choose({ kind: "core" }))}>
        <circle className="halo" cx={x} cy={y} r={r + 8 * scale} /><circle className="sun" cx={x} cy={y} r={r} style={{ fill: `url(#${gid}sun)` }} />
        <text x={x} y={y + 5} textAnchor="middle" className="corelabel">You</text><title>You</title>
      </g>) });
  }
  things.sort((a, b) => b.depth - a.depth);                         // far first, near last, so nearer things sit on top

  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  return (
    <div className="space3d">
      <div className="space-bar" role="toolbar" aria-label="Move around your universe">
        <button type="button" aria-label="Turn left" onClick={() => set(orbit(camRef.current, -0.3, 0))}>◀</button>
        <button type="button" aria-label="Turn right" onClick={() => set(orbit(camRef.current, 0.3, 0))}>▶</button>
        <button type="button" aria-label="Look up" onClick={() => set(orbit(camRef.current, 0, -0.2))}>▲</button>
        <button type="button" aria-label="Look down" onClick={() => set(orbit(camRef.current, 0, 0.2))}>▼</button>
        <button type="button" aria-label="Zoom in" onClick={() => set(zoom(camRef.current, 0.75))}>＋</button>
        <button type="button" aria-label="Zoom out" onClick={() => set(zoom(camRef.current, 1.33))}>－</button>
        <button type="button" onClick={() => travel(defaultCamera())}>Reset view</button>
        <button type="button" aria-pressed={spin} onClick={() => setSpin((s) => !s)}>Spin</button>
        <label className="travel"><span className="sr">Travel to</span>
          <select aria-label="Travel to" value="" onChange={(e) => {
            const v = e.target.value;
            if (v === "core") go({ kind: "core" }); else if (v.startsWith("p:")) go({ kind: "planet", provider: v.slice(2) }); else if (v.startsWith("c:")) go({ kind: "cluster", name: v.slice(2) } as never);
          }}>
            <option value="">Travel to…</option><option value="core">You</option>
            {u.ais.map((a) => <option key={a.provider} value={`p:${a.provider}`}>{a.name}</option>)}
            {scene.clusters.map((c) => <option key={c.name} value={`c:${c.name}`}>{`Memories: ${c.name}`}</option>)}
          </select></label>
        {onFlat && <button type="button" onClick={onFlat}>Flat map</button>}
      </div>
      <svg ref={svg} className={`universe space${u.paused ? " paused" : ""}`} viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Your universe: you, your AIs and what AIOS remembers"
        aria-roledescription="3D map. Drag to look around, scroll to move closer, arrow keys turn, plus and minus zoom, zero resets."
        data-yaw={fmt(cam.yaw)} data-pitch={fmt(cam.pitch)} data-dist={fmt(cam.dist)} data-target={cam.target.map(fmt).join(",")} tabIndex={0}
        onKeyDown={onKey} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={() => travel(defaultCamera())} onContextMenu={(e) => e.preventDefault()}>
        <defs>
          <radialGradient id={`${gid}sun`} cx="0.35" cy="0.3" r="0.85"><stop offset="0" stopColor="#fff" stopOpacity="0.95" /><stop offset="0.3" style={{ stopColor: "var(--accent)" }} /><stop offset="1" style={{ stopColor: "color-mix(in srgb, var(--accent) 45%, #000)" }} /></radialGradient>
          <radialGradient id={`${gid}manual`} cx="0.35" cy="0.3" r="0.9"><stop offset="0" stopColor="#fff" /><stop offset="1" style={{ stopColor: "color-mix(in srgb, var(--accent) 22%, var(--panel))" }} /></radialGradient>
        </defs>
        {frame.rings.map((r) => <path key={r.level} className={`orbit o-${r.level}`} d={r.d}><title>{`Ring: ${LEVEL_TEXT[r.level].short}`}</title></path>)}
        {frame.clusters.map(({ item: c, x, y, scale, opacity }) => (
          <g key={c.name} style={{ opacity }}><circle className="cluster" cx={x} cy={y} r={Math.max(6, (c.radius + 8) * scale)} /><text className="clabel" x={x} y={y - (c.radius + 12) * scale} textAnchor="middle" style={{ fontSize: clamp(11 * scale * 1.5, 9, 16) }}>{c.name}</text></g>))}
        {frame.beams.map((b) => <line key={b.key} className="beam" x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} />)}
        {things.map((t) => t.node)}
        {hud.map((c, i) => (
          <g key={c.kind} role="button" tabIndex={0} className={`comet cm-${c.kind}${sel?.kind === "comet" && sel.which === c.kind ? " sel" : ""}`} aria-label={`Waiting for you: ${c.label}`}
            onClick={click({ kind: "comet", which: c.kind })} onKeyDown={(e) => key(e, () => onSelect({ kind: "comet", which: c.kind }))}>
            <path className="tail" d={`M${c.x - 46} ${c.y - 12} L${c.x - 10} ${c.y - 2}`} /><circle cx={c.x} cy={c.y} r="9" /><text x={c.x + 16} y={c.y + 4} className="clabel hudlabel" data-i={i}>{c.label}</text><title>{c.label}</title>
          </g>))}
        {u.paused && <text x={W / 2} y={H - 14} textAnchor="middle" className="pausedlabel">Paused: nothing new will start until you resume</text>}
      </svg>
      <p className="muted small space-help">Drag to look around. Scroll or pinch to move closer. Click anything to fly to it. Shift-drag slides. Arrow keys turn, + and − zoom, 0 resets.</p>
    </div>
  );
}

export type { Vec3 };
export { project };
