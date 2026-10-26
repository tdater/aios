import { Suspense, lazy, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyArrivals } from "../core/arrival";
import { UObject, REGIONS, Region, layoutWorld, posAt } from "../core/scene";
import { Camera, clamp, defaultCamera, ease, lerpCamera, orbit, viewFor, zoom, project } from "../core/space3d";
import { ObjectList } from "../core/objects";
import { Universe } from "../core/types";
import { breadcrumb, cameraForBody, goTo, radar, regionCamera, regionNear } from "../core/travel";
import { ArrivalCaption } from "./ArrivalCaption";
import { useApp } from "./Context";
import { go, useLoad } from "./hooks";
import { Notice } from "./kit";
import { FirstLaunch, firstLaunchPending } from "./FirstLaunch";
import { MyDay } from "./MyDay";
import { ObjectCard } from "./ObjectCard";
import { WidgetGallery } from "./WidgetGallery";
import { ObjectField } from "./ObjectField";
import { useArrivals, prefersReducedMotion } from "./useArrivals";

const UniverseGL = lazy(() => import("./UniverseGL"));
const LABELLED = new Set(["sun", "planet", "station", "probe", "home", "allstop", "log", "comet", "wormhole", "beacon"]);

/** The whole app is this: your universe, full screen. Travel with the dock, Go to or by dragging; open anything to see and change it. */
export function Cockpit({ objectId, children }: { objectId?: string; children?: ReactNode }) {
  const { client, settings } = useApp();
  const uni = useLoad(() => client.get<Universe>("/universe"), [client], 15000);
  const objs = useLoad(() => client.get<ObjectList>("/universe/objects"), [client], 8000);
  const list: UObject[] | null = objs.data?.items ?? null;
  const world = useMemo(() => (uni.data && list ? layoutWorld(uni.data, list) : null), [uni.data, list]);
  const reduced = settings.reduceMotion === "on" || prefersReducedMotion();
  const arrivals = useArrivals(list, { reduced });

  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 560 });
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(320, el.clientWidth), h: Math.max(320, el.clientHeight) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const view = useMemo(() => viewFor(size.w, size.h), [size]);

  const [cam, setCam] = useState<Camera>(defaultCamera);
  const camRef = useRef(cam);
  camRef.current = cam;
  const [simT, setSimT] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [glOk, setGlOk] = useState(true);
  const [listView, setListView] = useState(false);
  const [goOpen, setGoOpen] = useState(false);
  const [region, setRegion] = useState<Region | null>(null);
  const [day, setDay] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [showcase, setShowcase] = useState(false);
  const [dayKey, setDayKey] = useState(0);
  const told = useMemo<string[]>(() => [], []);

  // One clock for everything that moves (about 30 frames a second, and none when calm mode is on or the tab is hidden).
  useEffect(() => {
    if (reduced || typeof requestAnimationFrame !== "function") return;
    let id = 0, last = 0;
    const t0 = performance.now();
    const loop = (now: number) => { if (now - last > 33 && !document.hidden) { last = now; setSimT((now - t0) / 1000); } id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [reduced]);

  const raf = useRef(0);
  const flyTo = useCallback((to: Camera, ms = 700) => {
    cancelAnimationFrame(raf.current);
    if (reduced || typeof requestAnimationFrame !== "function") { setCam(to); return; }
    const from = camRef.current, t0 = performance.now();
    const step = (now: number) => { const t = clamp((now - t0) / ms, 0, 1); setCam(lerpCamera(from, to, ease(t))); if (t < 1) raf.current = requestAnimationFrame(step); };
    raf.current = requestAnimationFrame(step);
  }, [reduced]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const selected = objectId && world?.bodies.some((b) => b.id === objectId) ? objectId : null;
  const body = selected ? world!.bodies.find((b) => b.id === selected)! : null;
  useEffect(() => {                                      // opening something (or a link to it) flies there
    if (!world) return;
    if (body) { flyTo(cameraForBody(body, camRef.current, posAt(world, body, simT))); setRegion(body.region); }
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {                                      // a new arrival: glide to it and hold
    const id = arrivals.focusId;
    if (!world || !id || reduced) return;
    const b = world.bodies.find((x) => x.id === id);
    if (b) flyTo(cameraForBody(b, camRef.current, posAt(world, b, simT)), 900);
  }, [arrivals.focusId]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (world ? applyArrivals(world, arrivals.active, performance.now(), simT) : null), [world, arrivals.active, arrivals.frames, simT]);
  const open = (id: string | null) => go(id ? { tab: "home", sub: "o", id } : { tab: "home" });
  const travelTo = (r: Region) => { if (world) { setRegion(r); flyTo(regionCamera(world, r, camRef.current)); } };

  // dragging looks around, the wheel moves closer or further, keys do the same
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onDown = (e: React.PointerEvent) => { if ((e.target as Element).closest("button, a, input, .object-card, .dock, .u-label")) return; drag.current = { x: e.clientX, y: e.clientY, moved: false }; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true; d.x = e.clientX; d.y = e.clientY; cancelAnimationFrame(raf.current); setCam(orbit(camRef.current, -dx * 0.006, dy * 0.006)); };
  const onUp = () => { drag.current = null; };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => { if ((e.target as Element).closest(".object-card, .mydock")) return; e.preventDefault(); setCam(zoom(camRef.current, Math.exp(e.deltaY * 0.0012))); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as Element).closest("input, textarea, select")) return;
    const k = e.key;
    if (k === "ArrowLeft") setCam(orbit(camRef.current, 0.1, 0)); else if (k === "ArrowRight") setCam(orbit(camRef.current, -0.1, 0));
    else if (k === "ArrowUp") setCam(orbit(camRef.current, 0, 0.08)); else if (k === "ArrowDown") setCam(orbit(camRef.current, 0, -0.08));
    else if (k === "+" || k === "=") setCam(zoom(camRef.current, 0.85)); else if (k === "-") setCam(zoom(camRef.current, 1.18));
    else if (k === "Escape") { if (goOpen) setGoOpen(false); else if (selected) open(null); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "g") { e.preventDefault(); setGoOpen(true); }
  };

  if (uni.loading && !uni.data) return <p className="muted" aria-busy="true">Loading your universe…</p>;
  if (!world || !shown) {
    return (
      <div className="screen">
        <Notice tone="warn">The universe is not available from this server yet{objs.error ? ` (${objs.error})` : ""}. If you just updated AIOS, restart it (run stop, then start) and refresh with Ctrl+Shift+R.</Notice>
        {children}
      </div>);
  }
  const useGL = glOk && settings.universeView !== "flat" && !listView;
  const crumbs = breadcrumb(world, selected, region ?? regionNear(world, cam.target));

  return (
    <div className="cockpit" ref={box} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey} tabIndex={-1} data-testid="cockpit">
      {!listView && (useGL ? (
        <Suspense fallback={null}>
          <UniverseGL world={shown} cam={cam} selected={selected} hovered={hovered} told={told} time={reduced ? 0 : simT} reducedMotion={reduced} onUnsupported={() => setGlOk(false)} />
        </Suspense>
      ) : (
        <ObjectField world={shown} cam={cam} view={view} selected={selected} hovered={hovered} frames={arrivals.frames} simT={simT} onPick={open} onHover={setHovered} />
      ))}
      {!listView && shown.bodies.map((b) => {
        if (!LABELLED.has(b.type) && b.id !== selected && b.id !== hovered) return null;
        const p = project(cam, posAt(shown, b, simT), view);
        if (!p || p.depth <= 0) return null;
        return (
          <button key={b.id} type="button" className={`u-label ${selected === b.id ? "on" : ""}`} style={{ left: p.x, top: p.y + Math.max(8, b.r * p.scale) + 4, opacity: arrivals.frames.get(b.id)?.alpha ?? 1 }}
            onClick={() => open(b.id)} onPointerEnter={() => setHovered(b.id)} onPointerLeave={() => setHovered(null)} aria-label={`${b.name}: ${b.state.text}`}>{b.name}</button>);
      })}
      {listView && <ListView world={world} onPick={(id) => { setListView(false); open(id); }} />}

      <div className="topbar">
        <nav className="crumbs" aria-label="Where you are">{crumbs.map((c, i) => <span key={i}>{i > 0 && " › "}{i === 0 && crumbs.length > 1 ? <button type="button" onClick={() => { open(null); setRegion(null); flyTo(defaultCamera()); }}>{c}</button> : c}</span>)}</nav>
        <button type="button" className="btn btn-quiet" onClick={() => setGoOpen(true)}>Go to… <kbd>Ctrl G</kbd></button>
        <button type="button" className="btn btn-quiet" aria-pressed={day} onClick={() => setDay((v) => !v)}>My Day</button>
        <button type="button" className="btn btn-quiet" onClick={() => go({ tab: "home", sub: "details" })}>Today and details</button>
        <button type="button" className="btn btn-quiet" aria-pressed={listView} onClick={() => setListView((v) => !v)}>{listView ? "Back to space" : "List view"}</button>
      </div>

      <nav className="dock" aria-label="Travel to a region">
        {REGIONS.map((r) => (
          <button key={r.id} type="button" className={region === r.id ? "on" : ""} aria-current={region === r.id ? "true" : undefined} title={r.question} onClick={() => travelTo(r.id)}>
            <span className="dock-name">{r.name}</span><span className="dock-q">{r.question}</span>
          </button>))}
      </nav>

      {!listView && <Radar world={world} cam={cam} selected={selected} onPick={open} />}
      {day && <div className="mydock"><MyDay refreshKey={dayKey} onAdd={() => setGallery(true)} /></div>}
      {gallery && (
        <div className="gallery-pop" role="dialog" aria-label="Launch a probe">
          <WidgetGallery onClose={() => setGallery(false)} onAdded={() => { setDayKey((n) => n + 1); setDay(true); void objs.reload(); if (firstLaunchPending()) setShowcase(true); }} />
        </div>)}
      {showcase && <FirstLaunch onDone={() => setShowcase(false)} />}
      {selected && <ObjectCard id={selected} onClose={() => open(null)} reload={() => { void objs.reload(); }} onReplay={() => arrivals.replay(selected)} />}
      <ArrivalCaption caption={arrivals.caption} onSkip={arrivals.skip} />
      {goOpen && <GoTo world={world} onClose={() => setGoOpen(false)} onPick={(d) => { setGoOpen(false); if (d.kind === "region") { open(null); travelTo(d.id as Region); } else open(d.id); }} />}
      <div className="cockpit-bottom">{children}</div>
    </div>
  );
}

function GoTo({ world, onPick, onClose }: { world: NonNullable<ReturnType<typeof layoutWorld>>; onPick: (d: ReturnType<typeof goTo>[number]) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const results = goTo(world, q);
  return (
    <div className="goto" role="dialog" aria-label="Go to" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Where to? A region, an AI, a project…" aria-label="Where to?" onKeyDown={(e) => { if (e.key === "Enter" && results[0]) onPick(results[0]); }} />
      <ul>{results.map((d) => <li key={`${d.kind}:${d.id}`}><button type="button" onClick={() => onPick(d)}><strong>{d.label}</strong> <span className="muted small">{d.sub}</span></button></li>)}</ul>
      {!results.length && <p className="muted small">Nothing by that name.</p>}
    </div>
  );
}

function Radar({ world, cam, selected, onPick }: { world: NonNullable<ReturnType<typeof layoutWorld>>; cam: Camera; selected: string | null; onPick: (id: string) => void }) {
  const S = 120;
  return (
    <svg className="radar" width={S} height={S} viewBox={`0 0 ${S} ${S}`} role="group" aria-label="Radar: a small map of everything">
      <circle cx={S / 2} cy={S / 2} r={S / 2 - 1} fill="rgba(5,10,24,.7)" stroke="#456" />
      {radar(world, S).map((p) => <circle key={p.id} cx={p.x} cy={p.y} r={p.id === selected ? 3.5 : 2} fill={p.id === selected ? "#fff" : "#8fb4ff"} onClick={() => onPick(p.id)} style={{ cursor: "pointer" }}><title>{world.bodies.find((b) => b.id === p.id)?.name}</title></circle>)}
      <line x1={S / 2} y1={S / 2} x2={S / 2 + Math.sin(cam.yaw) * 22} y2={S / 2 - Math.cos(cam.yaw) * 22} stroke="#ffd37a" />
    </svg>
  );
}

function ListView({ world, onPick }: { world: NonNullable<ReturnType<typeof layoutWorld>>; onPick: (id: string) => void }) {
  return (
    <div className="listview" aria-label="Everything in your universe, as a list">
      {REGIONS.map((r) => {
        const items = world.bodies.filter((b) => b.region === r.id);
        if (!items.length) return null;
        return (
          <section key={r.id}><h2>{r.name}</h2><p className="muted small">{r.question}</p>
            <ul>{items.map((b) => <li key={b.id}><button type="button" onClick={() => onPick(b.id)}><strong>{b.name}</strong> <span className="muted small">{b.state.text}. {b.job}</span></button></li>)}</ul>
          </section>);
      })}
    </div>
  );
}
