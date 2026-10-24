import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiosClient, ApiError, NetworkError } from "./core/client";
import { ConnectionMonitor } from "./core/connection";
import { createRuntime, Runtime } from "./core/runtime";
import { tokenKey } from "./core/secure";
import { ServerEntry } from "./core/servers";
import { API_VERSION, Meta } from "./core/types";
import { getPlatform, Platform } from "./platform";
import { registerServiceWorker, resetAppCaches, updateStore } from "./pwa/register";
import { Frame, Incompatible, Pair, ServerChanged, SetupServer, Unreachable } from "./screens/Boot";
import { Home } from "./screens/Home";
import { Inbox } from "./screens/Inbox";
import { Knowledge } from "./screens/Knowledge";
import { Projects } from "./screens/Projects";
import { Runs } from "./screens/Runs";
import { Settings } from "./screens/Settings";
import { AppContext, AppCtx } from "./ui/Context";
import { go, Route, useRoute, useStore, useViewport } from "./ui/hooks";
import { Btn, Notice } from "./ui/kit";

type Phase =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "unreachable"; server: ServerEntry; detail: string }
  | { kind: "changed"; server: ServerEntry; serverId: string }
  | { kind: "incompatible"; detail: string }
  | { kind: "pair"; server: ServerEntry; client: AiosClient }
  | { kind: "ready"; server: ServerEntry; client: AiosClient; monitor: ConnectionMonitor };

export default function App({ platform, runtime }: { platform?: Platform; runtime?: Runtime }) {
  const pf = platform ?? getPlatform();
  const rt = useMemo(() => runtime ?? createRuntime(pf), [runtime, pf]);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [gen, setGen] = useState(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const settings = useStore(rt.settings.store);
  const reinit = useCallback(() => setGen((g) => g + 1), []);

  useEffect(() => { void registerServiceWorker(pf.isNative); }, [pf.isNative]);

  // theme: "system" leaves the attribute off so prefers-color-scheme applies
  useEffect(() => {
    const el = document.documentElement;
    if (settings.theme === "system") el.removeAttribute("data-theme"); else el.dataset.theme = settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    let cancelled = false;
    let monitor: ConnectionMonitor | null = null;
    (async () => {
      setPhase({ kind: "loading" });
      let server = rt.registry.active();
      if (!server) {
        if (pf.isNative) return setPhase({ kind: "setup" });
        server = rt.registry.add("This server", "");
      }
      const client = new AiosClient(server.url, null, {
        onUnauthenticated: () => {
          const p = phaseRef.current;
          if (p.kind === "ready") {
            p.monitor.markUnauthenticated();
            void pf.secure.remove(tokenKey(p.server.id));
            setPhase({ kind: "pair", server: p.server, client: p.client });
          }
        },
        onIncompatible: () => setPhase({ kind: "incompatible", detail: "The server rejected this app version." }),
      });
      const token = pf.isNative ? await pf.secure.get(tokenKey(server.id)) : null;
      client.setAuth(pf.isNative ? (token ? { mode: "bearer", token } : null) : { mode: "cookie" });
      let meta: Meta;
      try {
        meta = await client.get<Meta>("/meta", { timeoutMs: 8000 });
      } catch (e) {
        return !cancelled && setPhase({ kind: "unreachable", server, detail: e instanceof Error ? e.message : String(e) });
      }
      if (cancelled) return;
      if (meta.api_version < API_VERSION || API_VERSION < meta.min_client_api)
        return setPhase({ kind: "incompatible", detail: `Server speaks API ${meta.api_version} and needs clients ≥ ${meta.min_client_api}; this app speaks ${API_VERSION}.` });
      if (rt.registry.recordServerId(server.id, meta.server_id) === "changed") return setPhase({ kind: "changed", server, serverId: meta.server_id });
      server = rt.registry.active()!;
      if (pf.isNative && !token) return setPhase({ kind: "pair", server, client });
      try {
        await client.get("/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return !cancelled && setPhase({ kind: "pair", server, client });
        return !cancelled && setPhase({ kind: "unreachable", server, detail: e instanceof NetworkError ? e.message : String(e) });
      }
      monitor = new ConnectionMonitor(client);
      monitor.start();
      if (!cancelled) setPhase({ kind: "ready", server, client, monitor });
    })();
    return () => { cancelled = true; monitor?.stop(); };
  }, [gen, rt, pf]);

  if (phase.kind === "loading") return <Frame title="Starting…"><p className="muted" aria-busy="true">Contacting your server…</p></Frame>;
  if (phase.kind === "setup")
    return <SetupServer allowDevLoopback={pf.allowDevLoopback} onAdd={(label, url) => { const e = rt.registry.add(label, url); rt.registry.setActive(e.id); reinit(); }} />;
  if (phase.kind === "unreachable")
    return <Unreachable label={phase.server.label} detail={phase.detail} onRetry={reinit} onSwitch={() => { rt.registry.clearActive(); reinit(); }} />;
  if (phase.kind === "incompatible") return <Incompatible detail={phase.detail} onReload={() => void resetAppCaches()} />;
  if (phase.kind === "changed")
    return <ServerChanged label={phase.server.label}
      onCancel={() => { rt.registry.clearActive(); reinit(); }}
      onConfirm={async () => { rt.cache.clearPartition(rt.partitionOf(phase.server)); rt.drafts.clear(rt.partitionOf(phase.server)); await pf.secure.remove(tokenKey(phase.server.id)); rt.registry.adoptServerId(phase.server.id, phase.serverId); reinit(); }} />;
  if (phase.kind === "pair")
    return <Pair serverLabel={phase.server.label} deviceDefault={pf.deviceLabel()}
      onSwitch={() => { rt.registry.clearActive(); reinit(); }}
      onPair={async (code, device) => {
        const r = await phase.client.post<{ token?: string }>("/auth/pair", { code, device_name: device, kind: pf.isNative ? "native" : "browser" });
        if (pf.isNative && r.data.token) await pf.secure.set(tokenKey(phase.server.id), r.data.token);
        reinit();
      }} />;

  return <Shell key={phase.server.id} phase={phase} rt={rt} pf={pf} reinit={reinit} />;
}

function Shell({ phase, rt, pf, reinit }: { phase: Extract<Phase, { kind: "ready" }>; rt: Runtime; pf: Platform; reinit: () => void }) {
  const conn = useStore(phase.monitor.store);
  const settings = useStore(rt.settings.store);
  const update = useStore(updateStore);
  const route = useRoute();
  const vp = useViewport();
  const partition = rt.partitionOf(phase.server);
  const connected = conn.state === "connected";

  useEffect(() => pf.onBack(() => {
    if (route.id) { history.back(); return true; }
    if (route.tab !== "home") { go({ tab: "home" }); return true; }
    return false;
  }), [pf, route]);

  const ctx: AppCtx = {
    client: phase.client, server: phase.server, registry: rt.registry, conn, connected, partition, cache: rt.cache, drafts: rt.drafts,
    settings, updateSettings: rt.settings.update, isNative: pf.isNative,
    signOut: async () => {
      try { await phase.client.post("/auth/logout"); } catch { /* server unreachable: still drop the local credential */ }
      await pf.secure.remove(tokenKey(phase.server.id));
      rt.cache.clearPartition(partition);   // cached summaries go; drafts are the user's own text and stay
      reinit();
    },
    switchServer: (id) => { if (id) rt.registry.setActive(id); else rt.registry.clearActive(); reinit(); },
    removeServer: async (id) => { await rt.registry.remove(id); reinit(); },
    clearLocalData: () => {
      void Promise.all(rt.registry.list().map((s) => pf.secure.remove(tokenKey(s.id)))).then(() => {
        rt.cache.clearAll(); rt.drafts.clearAll(); rt.registry.list().forEach((s) => void rt.registry.remove(s.id)); reinit();
      });
    },
  };

  const pending = rt.drafts.pendingCount(partition);
  const tabs: [Route["tab"], string, string][] = [["home", "Home", "⌂"], ["projects", "Projects", "▤"], ["runs", "Runs", "▶"], ["inbox", "Inbox", "✉"], ["knowledge", "Knowledge", "☰"], ["settings", "Settings", "⚙"]];
  return (
    <AppContext.Provider value={ctx}>
      <div className={`shell ${vp.mode} ${vp.landscape ? "landscape" : "portrait"}`} data-layout={vp.mode}>
        <header className="top">
          <span className="brand">AIOS</span>
          <span className={`pill ${conn.state}`} role="status" aria-live="polite">● {conn.state}</span>
          {pending > 0 && <span className="pill warn" title="Local drafts not yet sent">{pending} pending sync</span>}
        </header>
        {update.ready && <Notice tone="info">A new version is ready. <Btn kind="ghost" onClick={update.apply}>Reload to update</Btn></Notice>}
        {!connected && conn.state !== "connecting" && (
          <Notice tone="warn">{conn.state === "unauthenticated" ? "Signed out." : conn.state === "stale" ? "Connection is stale." : "Disconnected."} What you see may be out of date, and approvals and other changes are disabled until you reconnect.</Notice>
        )}
        <nav className="nav" aria-label="Main">
          {tabs.map(([t, label, icon]) => (
            <button key={t} className={route.tab === t ? "on" : ""} aria-current={route.tab === t ? "page" : undefined} onClick={() => go({ tab: t })}>
              <span aria-hidden="true">{icon}</span><span>{label}</span>
            </button>))}
        </nav>
        <main className="content" id="main">
          {route.tab === "home" && <Home />}
          {route.tab === "projects" && <Projects id={route.id} />}
          {route.tab === "runs" && <Runs id={route.id} />}
          {route.tab === "inbox" && <Inbox sub={route.sub} id={route.id} />}
          {route.tab === "knowledge" && <Knowledge id={route.id} />}
          {route.tab === "settings" && <Settings />}
        </main>
      </div>
    </AppContext.Provider>
  );
}
