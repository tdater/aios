import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError, NetworkError } from "../core/client";
import { Store } from "../core/connection";

export function useStore<T>(s: Store<T>): T {
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}

export interface Loaded<T> { data: T | null; error: string | null; errorCode: string | null; loading: boolean; reload: () => Promise<void>; at: Date | null }

/** Load data from the server. Never invents data: failure leaves `data` as the last good value and sets `error`. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], pollMs = 0): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState<Date | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const d = await fnRef.current();
      if (!alive.current) return;
      setData(d);
      setError(null);
      setErrorCode(null);
      setAt(new Date());
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setErrorCode(e instanceof ApiError ? e.code : e instanceof NetworkError ? e.kind : "error");
    } finally {
      if (alive.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    alive.current = true;
    setLoading(true);
    void load();
    const t = pollMs ? setInterval(() => void load(), pollMs) : null;
    return () => {
      alive.current = false;
      if (t) clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, errorCode, loading, reload: load, at };
}

export type LayoutMode = "phone" | "tablet" | "desktop";
export function layoutFor(width: number): LayoutMode {
  return width < 600 ? "phone" : width < 1024 ? "tablet" : "desktop";
}
export function useViewport() {
  const read = () => ({ w: globalThis.innerWidth ?? 1024, h: globalThis.innerHeight ?? 768 });
  const [v, setV] = useState(read);
  useEffect(() => {
    const f = () => setV(read());
    globalThis.addEventListener("resize", f);
    globalThis.addEventListener("orientationchange", f);
    return () => {
      globalThis.removeEventListener("resize", f);
      globalThis.removeEventListener("orientationchange", f);
    };
  }, []);
  return { ...v, mode: layoutFor(v.w), landscape: v.w > v.h, twoPane: v.w >= 840 };
}

// ---- hash router: Android back / browser back / swipe-back all just work via history ----
export interface Route { tab: "home" | "work" | "projects" | "runs" | "inbox" | "knowledge" | "graph" | "insights" | "ais" | "settings"; id?: string; sub?: string }
const TABS = ["home", "work", "projects", "runs", "inbox", "knowledge", "graph", "insights", "ais", "settings"] as const;
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const tab = (TABS as readonly string[]).includes(parts[0]) ? (parts[0] as Route["tab"]) : "home";
  if (tab === "inbox" && parts[1] && parts[2]) return { tab, sub: parts[1], id: parts[2] };
  if (tab === "home" && parts[1] === "details") return { tab, sub: "details" };
  if (tab === "home" && parts[1] === "o" && parts[2]) return { tab, sub: "o", id: parts[2] };      // #/home/o/<object id>: a spot in the universe
  return { tab, id: parts[1] };
}
export const routeHref = (r: Route) =>
  `#/${[r.tab, r.sub, r.id].filter(Boolean).map((s) => encodeURIComponent(s as string)).join("/")}`;
export const routeStore = new Store<Route>(parseRoute(globalThis.location?.hash ?? ""));
if (typeof window !== "undefined") window.addEventListener("hashchange", () => routeStore.set(parseRoute(location.hash)));
export const go = (r: Route) => {
  location.hash = routeHref(r);
};
export const useRoute = () => useStore(routeStore);
