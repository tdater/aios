import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ANCHORS, layoutWorld, posAt, type World } from "../src/core/scene";
import { sampleObjects, sampleUniverse } from "../src/core/scene.fixtures";
import { clampCamera, defaultCamera, orbit, project, viewFor, zoom, type Camera, type Vec3 } from "../src/core/space3d";
import type { Engine } from "../src/gl/engine";
import { UniverseGL } from "../src/ui/UniverseGL";

// Development harness for the WebGL universe (not part of the production build). Served by the Vite dev server at
// /dev/gl.html. URL parameters: yaw, pitch, dist, tx, ty, tz, focus=<body id> (follow it), t=<seconds> (freeze time),
// sel, hov, rm=1 (reduced motion), q=<0..3> (force quality level), ui=0 (no panels), labels=1, align=1 (marker test),
// slow=<ms> (burn CPU each frame to exercise the quality governor).
const qs = new URLSearchParams(location.search);
const num = (k: string, d: number) => (qs.has(k) ? Number(qs.get(k)) : d);
const ALIGN_POINTS: Vec3[] = [[0, 0, 0], [200, 30, -100], [-300, -50, 150], [120, -80, 260], [-150, 120, -260]];

declare global {
  interface Window { __gl: { ready: boolean; frames: number[]; engine: Engine | null; tier: string; expected: { x: number; y: number }[]; cam: Camera; size: { w: number; h: number } } }
}
window.__gl = { ready: false, frames: [], engine: null, tier: "high", expected: [], cam: defaultCamera(), size: { w: 0, h: 0 } };

function Harness() {
  const align = qs.get("align") === "1";
  const world: World = useMemo(() => align
    ? { bodies: [], stars: [], clusters: [], rings: [], belt: null, anchors: ANCHORS, extent: 1000 }
    : layoutWorld(sampleUniverse(), sampleObjects()), [align]);
  const u = useMemo(() => sampleUniverse(), []);
  const fixedT = qs.has("t") ? Number(qs.get("t")) : null;
  const [cam, setCam] = useState<Camera>(() => clampCamera({ ...defaultCamera(), yaw: num("yaw", 0.35), pitch: num("pitch", 0.42), dist: num("dist", 760), target: [num("tx", 0), num("ty", 0), num("tz", 0)] }));
  const [focus, setFocus] = useState<string | null>(qs.get("focus"));
  const [selected, setSelected] = useState<string | null>(qs.get("sel"));
  const [time, setTime] = useState(fixedT ?? 0);
  const [fps, setFps] = useState({ ms: 0, tier: "high", calls: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const rm = qs.get("rm") === "1";
  const slowMs = num("slow", 0);

  // Own the clock so the followed body and the renderer agree.
  useEffect(() => {
    if (fixedT !== null) return;
    let raf = 0; const t0 = performance.now();
    const tick = () => { setTime((performance.now() - t0) / 1000); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fixedT]);

  const body = focus ? world.bodies.find((b) => b.id === focus) : undefined;
  const cluster = qs.get("cluster") ? world.clusters.find((c) => c.name === qs.get("cluster")) : undefined;
  const viewCam: Camera = body ? { ...cam, target: posAt(world, body, time) } : cluster ? { ...cam, target: cluster.pos } : cam;
  window.__gl.cam = viewCam;

  const [size, setSize] = useState({ w: 1, h: 1 });
  useEffect(() => {
    const el = stage.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  window.__gl.size = size;
  window.__gl.expected = ALIGN_POINTS.map((p) => { const q = project(viewCam, p, viewFor(size.w, size.h)); return q ? { x: q.x, y: q.y } : { x: NaN, y: NaN }; });

  const drag = useRef<{ x: number; y: number } | null>(null);
  const told = useMemo(() => {
    const ai = selected?.startsWith("planet:") ? u.ais.find((a) => `planet:${a.provider}` === selected) : undefined;
    return ai ? ai.told : [];
  }, [selected, u]);

  const frames = useRef<number[]>([]);
  useEffect(() => {
    const id = setInterval(() => {
      const f = frames.current.slice(-60);
      const ms = f.length ? f.reduce((a, b) => a + b, 0) / f.length : 0;
      setFps({ ms, tier: window.__gl.tier, calls: engine.current?.lastDrawCalls ?? 0 });
    }, 500);
    return () => clearInterval(id);
  }, []);

  const showUi = qs.get("ui") !== "0";
  const labels = qs.get("labels") === "1";
  return (
    <div
      ref={stage}
      className="stage"
      onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY }; (e.target as Element).setPointerCapture?.(e.pointerId); }}
      onPointerMove={(e) => { if (!drag.current) return; const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y; drag.current = { x: e.clientX, y: e.clientY }; setCam((c) => orbit(c, -dx * 0.005, dy * 0.005)); }}
      onPointerUp={() => { drag.current = null; }}
      onWheel={(e) => setCam((c) => zoom(c, e.deltaY > 0 ? 1.1 : 1 / 1.1))}
    >
      <UniverseGL
        world={world} cam={viewCam} selected={selected} hovered={qs.get("hov")} told={told} time={fixedT ?? time} reducedMotion={rm}
        debugMarkers={align ? ALIGN_POINTS : undefined}
        onReady={() => { window.__gl.ready = true; }}
        onQuality={(t) => { window.__gl.tier = t; }}
        onFrame={(ms) => { if (slowMs > 0) { const end = performance.now() + slowMs; while (performance.now() < end) { /* simulate a slow device */ } } frames.current.push(ms); window.__gl.frames.push(ms); if (frames.current.length > 600) frames.current.splice(0, 300); }}
        onUnsupported={(r) => { document.title = `unsupported: ${r}`; }}
        onEngine={(e) => {
          engine.current = e; window.__gl.engine = e;
          if (e && qs.has("q")) e.setQualityLevel(Number(qs.get("q")));
        }}
      />
      {labels && world.bodies.map((b) => { const p = project(viewCam, posAt(world, b, fixedT ?? time), viewFor(size.w, size.h)); return p ? <div key={b.id} className="label" style={{ left: p.x, top: p.y }}>{b.name}</div> : null; })}
      {showUi && (
        <>
          <div className="hud">{fps.ms ? `${fps.ms.toFixed(1)} ms (${(1000 / fps.ms).toFixed(0)} fps)` : "..."} | {fps.tier} | {fps.calls} calls</div>
          <div className="list" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
            <button onClick={() => { setFocus(null); setSelected(null); setCam(defaultCamera()); }}>Overview</button>
            {world.bodies.map((b) => (
              <button key={b.id} aria-pressed={selected === b.id} onClick={() => { setSelected(b.id); setFocus(b.id); setCam((c) => clampCamera({ ...c, dist: Math.max(70, b.r * (b.type === "nebula" ? 4 : 6)) })); }}>
                {b.name} <small style={{ opacity: 0.6 }}>{b.type}</small>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>);
