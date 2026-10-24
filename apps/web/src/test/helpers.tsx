import { ReactNode } from "react";
import { AiosClient } from "../core/client";
import { ConnSnapshot } from "../core/connection";
import { createRuntime } from "../core/runtime";
import { MemoryKV } from "../core/storage";
import { Platform, webPlatform } from "../platform";
import { AppContext, AppCtx } from "../ui/Context";
import { parseRoute, routeStore } from "../ui/hooks";
import { META } from "./fakeServer";

export function resetRoute(hash = "") {
  location.hash = hash;
  routeStore.set(parseRoute(hash));
}
export function setWidth(w: number, h = 800) {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: h, configurable: true });
  window.dispatchEvent(new Event("resize"));
}
export const newPlatform = (over: Partial<Platform> = {}): Platform => ({ ...webPlatform, secure: webPlatform.secure, ...over });

/** Context for rendering one screen in isolation. `connected` drives the offline/online behaviour. */
export function ctxFor(over: { connected?: boolean; cacheEnabled?: boolean; partition?: string } = {}) {
  const rt = createRuntime(webPlatform, new MemoryKV());
  if (over.cacheEnabled) rt.settings.update({ cacheEnabled: true });
  const server = rt.registry.add("Test", "");
  const partition = over.partition ?? "srv_test1";
  const conn: ConnSnapshot = { state: over.connected === false ? "disconnected" : "connected", lastOkAt: new Date().toISOString(), meta: META as never };
  const ctx: AppCtx = {
    client: new AiosClient("", { mode: "bearer", token: "t" }), server, registry: rt.registry, conn, connected: over.connected !== false,
    partition, cache: rt.cache, drafts: rt.drafts, settings: rt.settings.store.get(), updateSettings: rt.settings.update, isNative: false,
    signOut: async () => {}, switchServer: () => {}, removeServer: async () => {}, clearLocalData: () => {},
  };
  return { ctx, rt };
}
export const Wrap = ({ ctx, children }: { ctx: AppCtx; children: ReactNode }) => <AppContext.Provider value={ctx}>{children}</AppContext.Provider>;
