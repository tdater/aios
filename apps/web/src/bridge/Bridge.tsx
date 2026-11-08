import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UObject, REGIONS, Region, layoutWorld } from "../core/scene";
import { ObjectList } from "../core/objects";
import { Destination, destinations } from "../core/travel";
import { Universe } from "../core/types";
import { Cockpit, CockpitCommand } from "../ui/Cockpit";
import { useApp } from "../ui/Context";
import { go, useLoad } from "../ui/hooks";
import { Notice } from "../ui/kit";
import { prefersReducedMotion } from "../ui/useArrivals";
import { Area, bridgeLayout, looksLikeTv, nextArea } from "./layout";
import { parallaxOffset } from "./parallax";
import { AlertsWall, HoloTable, OpsWall, StatusStrip, TodayBank } from "./panels";
import { WarpPhase, warpPlan } from "./warp";

const NONE: UObject[] = [];

/** Home as a ship bridge: the universe is the window; the walls and the table around it are your real work. */
export function Bridge({ objectId, children }: { objectId?: string; children?: ReactNode }) {
  const { client, settings } = useApp();
  const uni = useLoad(() => client.get<Universe>("/universe"), [client], 15000);
  const objs = useLoad(() => client.get<ObjectList>("/universe/objects"), [client], 8000);
  const list = objs.data?.items ?? NONE;
  const world = useMemo(() => (uni.data && objs.data ? layoutWorld(uni.data, objs.data.items) : null), [uni.data, objs.data]);
  const reduced = settings.reduceMotion === "on" || prefersReducedMotion();

  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  useEffect(() => { const on = () => setWidth(window.innerWidth); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, []);
  const layout = bridgeLayout(width, typeof navigator !== "undefined" && looksLikeTv(navigator.userAgent));

  const stage = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<Destination | null>(null);
  const [phase, setPhase] = useState<WarpPhase>("idle");
  const [command, setCommand] = useState<CockpitCommand | undefined>(undefined);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const swapped = useRef(true);
  const pending = useRef<Destination | null>(null);
  const counter = useRef(0);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clearTimers, []);

  /** Arrive: an object opens its card in the window; a region moves the window camera. Runs exactly once per trip. */
  const arrive = useCallback((d: Destination) => {
    if (swapped.current) return;
    swapped.current = true;
    if (d.kind === "region") { go({ tab: "home" }); setCommand({ kind: "region", id: d.id as Region, n: ++counter.current }); }
    else go({ tab: "home", sub: "o", id: d.id });
  }, []);

  const engage = useCallback((d: Destination) => {
    if (!swapped.current) return;                             // a trip is already under way
    clearTimers();
    swapped.current = false;
    pending.current = d;
    setTarget(null);
    const { total, swapAt } = warpPlan(reduced);
    setPhase("charge");
    if (!reduced) timers.current.push(setTimeout(() => setPhase("streak"), Math.round(swapAt * 0.4)));
    timers.current.push(setTimeout(() => { arrive(d); setPhase("arrive"); }, swapAt));
    timers.current.push(setTimeout(() => setPhase("idle"), total));
  }, [reduced, arrive]);

  const skip = useCallback(() => {
    clearTimers();
    if (pending.current) arrive(pending.current);
    setPhase("idle");
  }, [arrive]);

  const dests = useMemo(() => (world ? destinations(world) : []), [world]);
  const parallaxOn = layout === "desktop" && !reduced;
  const onPointerMove = (e: React.PointerEvent) => {
    const el = stage.current;
    if (!el || !parallaxOn) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    const f = parallaxOffset(nx, ny, 1, true), p = parallaxOffset(nx, ny, 0.35, true);
    el.style.setProperty("--bx", `${f.x}px`); el.style.setProperty("--by", `${f.y}px`);
    el.style.setProperty("--px", `${p.x}px`); el.style.setProperty("--py", `${p.y}px`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as Element;
    if (e.key === "Escape" && phase !== "idle") { e.preventDefault(); skip(); return; }
    if (t.closest("input, textarea, select") || t.closest(".cockpit")) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") { e.preventDefault(); search.current?.focus(); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") { e.preventDefault(); search.current?.focus(); return; }
    if (/^[1-6]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const d = dests.find((x) => x.kind === "region" && x.id === REGIONS[Number(e.key) - 1].id);
      if (d) engage(d);
      return;
    }
    const dir = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as const)[e.key as "ArrowLeft"];
    const from = t.closest("[data-area]")?.getAttribute("data-area") as Area | null;
    if (dir && from) {
      const to = nextArea(from, dir, layout);
      if (to === from) return;
      e.preventDefault();
      stage.current?.querySelector<HTMLElement>(`[data-area="${to}"] button:not([disabled]), [data-area="${to}"] input`)?.focus();
    }
  };

  if (uni.loading && !uni.data) return <p className="muted" aria-busy="true">Loading your bridge…</p>;
  if (!world) {
    return (
      <div className="screen">
        <Notice tone="warn">The bridge cannot show your universe yet{objs.error ? ` (${objs.error})` : ""}. If you just updated AIOS, restart it (run stop, then start) and refresh with Ctrl+Shift+R.</Notice>
        {children}
      </div>);
  }

  return (
    <div className={`bridge bridge-${layout} ${reduced ? "calm" : ""} warp-${phase}`} ref={stage} data-testid="bridge" data-layout={layout} data-phase={phase} onPointerMove={onPointerMove} onKeyDown={onKeyDown}>
      <svg className="bridge-frame" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="bf-hull" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0b1220" /><stop offset="1" stopColor="#05080f" /></linearGradient>
          <linearGradient id="bf-glow" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#ff9a3c" /><stop offset=".5" stopColor="#5ee2d6" /><stop offset="1" stopColor="#ff9a3c" /></linearGradient>
        </defs>
        <rect width="1600" height="900" fill="url(#bf-hull)" />
        <g stroke="#1b2740" strokeWidth="2" fill="none"><path d="M0 120H1600M0 780H1600M200 0V900M1400 0V900" /></g>
        <rect x="360" y="70" width="880" height="520" rx="26" fill="none" stroke="url(#bf-glow)" strokeWidth="5" opacity=".8" />
        <rect x="18" y="130" width="14" height="520" rx="7" fill="#ff9a3c" opacity=".55" /><rect x="1568" y="130" width="14" height="520" rx="7" fill="#ff9a3c" opacity=".55" />
      </svg>
      <div className="bridge-window" role="region" aria-label="Viewscreen: your universe" onClickCapture={(e) => { if (phase !== "idle") { e.stopPropagation(); skip(); } }}>
        <Cockpit objectId={objectId} windowMode command={command} />
        <div className="warp-fx" aria-hidden="true" />
      </div>
      <OpsWall objects={list} />
      <HoloTable world={world} target={target} onTarget={setTarget} onEngage={engage} searchRef={search} />
      <AlertsWall objects={list} />
      <TodayBank objects={list} memories={uni.data?.you.approved ?? null} />
      <StatusStrip objects={list} />
      <div className="bridge-ask">{children}</div>
    </div>
  );
}
