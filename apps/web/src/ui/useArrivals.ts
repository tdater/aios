import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Arrival, Frame, arrivalAt, holdUntil, newObjects, planArrivals } from "../core/arrival";
import { playPing } from "../core/ping";
import { UObject } from "../core/scene";

export const prefersReducedMotion = (): boolean => {
  try { return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
};

export interface Arrivals {
  /** The arrivals still playing or waiting to play. */
  active: Arrival[];
  /** How far along each one is right now (by object id), for the renderer. */
  frames: Map<string, Frame>;
  /** The line to show while something is arriving, or null. */
  caption: string | null;
  /** The newest arrival, which the camera glides to and holds on until `holdMs` has passed. */
  focusId: string | null;
  skip: () => void;
  replay: (id: string) => void;
}

/** Watches the list of objects; when one that was not there before shows up it plays that object's arrival.
 *  The first list it sees is never animated. `now` is injectable so tests do not need real time. */
export function useArrivals(objects: readonly UObject[] | null, opts: { now?: () => number; reduced?: boolean } = {}): Arrivals {
  const clock = opts.now ?? (() => performance.now());
  const seen = useRef<Set<string> | null>(null);
  const byId = useRef<Map<string, UObject>>(new Map());
  const [active, setActive] = useState<Arrival[]>([]);
  const [tick, setTick] = useState(0);

  const start = useCallback((fresh: UObject[]) => {
    if (!fresh.length) return;
    const plan = planArrivals(fresh, clock(), opts.reduced ?? prefersReducedMotion());
    setActive((cur) => [...cur.filter((a) => !plan.some((p) => p.id === a.id)), ...plan]);
    playPing();
  }, [clock, opts.reduced]);

  useEffect(() => {
    if (!objects) return;
    byId.current = new Map(objects.map((o) => [o.id, o]));
    start(newObjects(seen.current, objects));
    seen.current = new Set(objects.map((o) => o.id));
  }, [objects, start]);

  // Redraw about 60 times a second only while something is arriving; stop completely when nothing is.
  useEffect(() => {
    if (!active.length) return;
    let raf = 0;
    const loop = () => {
      const t = clock();
      setActive((cur) => { const left = cur.filter((a) => !arrivalAt(a, t).done); return left.length === cur.length ? cur : left; });
      setTick((n) => n + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active.length, clock]);

  const frames = useMemo(() => {
    const t = clock();
    return new Map(active.map((a) => [a.id, arrivalAt(a, t)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tick]);

  const skip = useCallback(() => setActive([]), []);
  const replay = useCallback((id: string) => {
    const o = byId.current.get(id);
    if (o) start([o]);
  }, [start]);

  const t = clock();
  const current = active.filter((a) => t >= a.start).sort((a, b) => b.start - a.start)[0] ?? active[0];
  return {
    active, frames, skip, replay,
    caption: current ? (active.length > 1 ? `${current.caption} (+${active.length - 1} more)` : current.caption) : null,
    focusId: active.length && t < holdUntil(active) ? current?.id ?? null : null,
  };
}
