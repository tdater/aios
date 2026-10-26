import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiosClient, ApiError, NetworkError } from "./core/client";
import { ConnectionMonitor } from "./core/connection";
import { createRuntime, Runtime } from "./core/runtime";
import { tokenKey } from "./core/secure";
import { ServerEntry } from "./core/servers";
import { tabVisible } from "./core/modes";
import { THEME_MODES } from "./core/settings";
import { applyTheme } from "./core/theme";
import { API_VERSION, Home as HomeData, Meta } from "./core/types";
import { ensureDailyNote } from "./core/daily";
import { isDocumentRoute } from "./core/workspace";
import { getPlatform, Platform } from "./platform";
import { registerServiceWorker, resetAppCaches, updateStore } from "./pwa/register";
import { Frame, Incompatible, Pair, ServerChanged, SetupServer, Unreachable } from "./screens/Boot";
import { GraphScreen } from "./screens/Graph";
import { InsightsScreen } from "./screens/Insights";
import { MyAIs } from "./screens/MyAIs";
import { Home } from "./screens/Home";
import { Inbox } from "./screens/Inbox";
import { Knowledge } from "./screens/Knowledge";
import { Projects } from "./screens/Projects";
import { Runs } from "./screens/Runs";
import { Settings } from "./screens/Settings";
import { Workspace } from "./screens/Workspace";
import { ShortcutsHelp, StatusBar, TabStrip, Toast } from "./ui/Chrome";
import { AppContext, AppCtx } from "./ui/Context";
import { go, Route, useRoute, useStore, useViewport } from "./ui/hooks";
import { useHotkeys } from "./ui/hotkeys";
import { Icon, IconName } from "./ui/icons";
import { Btn, Notice } from "./ui/kit";
import { invalidatePaletteIndex, Palette } from "./ui/Palette";
import { closePalette, helpStore, layoutPrefs, openPalette, paletteStore, setExplorer, summaryStore, toast } from "./ui/uiState";
import { modLabel } from "./ui/hotkeys";

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
  useEffect(() => { applyTheme(settings); }, [settings]);       // theme, accent, font size, reading width, motion

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

// The main path comes first (Workspace -> Projects -> Runs -> Inbox for approvals). Notes and the graph are
// still here, but quieter: they are the secondary experience, not the product.
const NAV: { tab: Route["tab"]; label: string; icon: IconName; wideOnly?: boolean; secondary?: boolean }[] = [
  { tab: "home", label: "Home", icon: "home" }, { tab: "work", label: "Workspace", icon: "chat" }, { tab: "projects", label: "Projects", icon: "folder" },
  { tab: "runs", label: "Runs", icon: "play" }, { tab: "inbox", label: "Inbox", icon: "inbox" }, { tab: "ais", label: "My AIs", icon: "users" }, { tab: "insights", label: "Insights", icon: "star" },
  { tab: "knowledge", label: "Knowledge", icon: "book", secondary: true }, { tab: "graph", label: "Graph", icon: "graph", wideOnly: true, secondary: true },
  { tab: "settings", label: "Settings", icon: "settings" },
];

function Shell({ phase, rt, pf, reinit }: { phase: Extract<Phase, { kind: "ready" }>; rt: Runtime; pf: Platform; reinit: () => void }) {
  const conn = useStore(phase.monitor.store);
  const settings = useStore(rt.settings.store);
  const update = useStore(updateStore);
  const summary = useStore(summaryStore);
  const route = useRoute();
  const vp = useViewport();
  const partition = rt.partitionOf(phase.server);
  const workspace = useMemo(() => rt.workspaceFor(partition), [rt, partition]);
  const connected = conn.state === "connected";
  const wide = vp.w >= 600;

  // open documents become tabs
  useEffect(() => { if (isDocumentRoute(route)) workspace.visit(route); }, [route, workspace]);

  // live counts for the ribbon badge and status bar (polite: only while connected, every 15 s)
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    const load = () => phase.client.get<HomeData>("/home").then((h) => alive && summaryStore.set({
      approvals: h.counts.pending_approvals, running: h.counts.active_runs, blocked: h.counts.blocked_runs, candidates: h.counts.pending_candidates })).catch(() => {});
    void load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [connected, phase.client]);

  useEffect(() => pf.onBack(() => {
    if (paletteStore.get().open) { closePalette(); return true; }
    if (route.id) { history.back(); return true; }
    if (route.tab !== "home") { go({ tab: "home" }); return true; }
    return false;
  }), [pf, route]);

  const ctx: AppCtx = {
    client: phase.client, server: phase.server, registry: rt.registry, conn, connected, partition, cache: rt.cache, drafts: rt.drafts, workspace,
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
  const closeActiveTab = () => {
    const active = location.hash;
    const next = workspace.close(active, active);
    if (next) location.hash = next; else go({ tab: route.tab });
  };
  const pinActiveTab = () => {
    if (!workspace.store.get().tabs.some((t) => t.href === location.hash)) { toast("Open a note, run or graph first, then pin its tab"); return; }
    toast(workspace.togglePin(location.hash) ? "Tab pinned" : "Tab unpinned");
  };
  const openDaily = () => {
    if (!connected) { toast("Daily notes need a connection"); return; }
    ensureDailyNote(phase.client, new Date()).then((id) => go({ tab: "knowledge", id }), (e) => toast(`Could not open the daily note: ${e instanceof Error ? e.message : "error"}`, 4000));
  };
  const cycleTab = (dir: 1 | -1) => { const n = workspace.neighbour(location.hash, dir); if (n) location.hash = n; };
  const commands: Record<string, () => void> = {
    capture: () => { go({ tab: "home" }); setTimeout(() => (document.querySelector('form[aria-label="Quick capture"] textarea') as HTMLElement | null)?.focus(), 80); },
    "new-note": () => go({ tab: "knowledge", id: "new" }),
    daily: openDaily,
    "pin-tab": pinActiveTab,
    approvals: () => go({ tab: "inbox" }),
    theme: () => { const ids = THEME_MODES.map((t) => t.id); const next = ids[(ids.indexOf(settings.theme) + 1) % ids.length]; rt.settings.update({ theme: next }); toast(`Theme: ${THEME_MODES.find((t) => t.id === next)!.label}`); },
    explorer: () => setExplorer(!layoutPrefs.get().explorer),
    tabs: () => rt.settings.update({ tabs: !settings.tabs }),
    "close-tab": closeActiveTab,
    history: () => go({ tab: "settings", id: "history" }),
    pair: () => go({ tab: "settings" }),
    help: () => helpStore.set(true),
    refresh: () => { invalidatePaletteIndex(); toast("Search index will refresh"); },
    signout: () => void ctx.signOut(),
  };
  useHotkeys({
    "mod+k": () => (paletteStore.get().open ? closePalette() : openPalette()),
    "mod+o": () => openPalette(), "mod+p": () => openPalette(">"),
    "mod+\\": () => setExplorer(!layoutPrefs.get().explorer),
    "mod+alt+d": openDaily, "alt+p": pinActiveTab,
    "alt+w": closeActiveTab, "alt+arrowright": () => cycleTab(1), "alt+arrowleft": () => cycleTab(-1),
    "?": () => helpStore.set(true), g: () => go({ tab: "graph" }),
  });

  const badge = summary?.approvals ?? 0;
  const flush = route.tab === "graph" || route.tab === "knowledge";
  return (
    <AppContext.Provider value={ctx}>
      <div className={`shell ${vp.mode} ${vp.landscape ? "landscape" : "portrait"}`} data-layout={vp.mode}>
        <header className="top">
          <span className="brand">AIOS</span>
          <span className="grow" />
          <button className="searchbtn" onClick={() => openPalette()} aria-label="Search and commands">
            <Icon name="search" size={16} /><span className="label">Search or run a command…</span>{wide && <kbd>{modLabel()} K</kbd>}
          </button>
          <span className={`pill ${conn.state}`} role="status" aria-live="polite">● {conn.state}</span>
          {pending > 0 && <span className="pill warn" title="Local drafts not yet sent">{pending} pending sync</span>}
        </header>
        {update.ready && <Notice tone="info">A new version is ready. <Btn kind="ghost" onClick={update.apply}>Reload to update</Btn></Notice>}
        {!connected && conn.state !== "connecting" && (
          <Notice tone="warn">{conn.state === "unauthenticated" ? "Signed out." : conn.state === "stale" ? "Connection is stale." : "Disconnected."} What you see may be out of date, and approvals and other changes are disabled until you reconnect.</Notice>
        )}
        <nav className="nav" aria-label="Main">
          {NAV.filter((n) => tabVisible(settings, n.tab)).map((n) => (
            <span key={n.tab} style={{ display: "contents" }}>
              {n.tab === "settings" && <span className="spacer" />}
              {n.tab === "knowledge" && <span className="navdivider" aria-hidden="true" />}
              <button className={`${route.tab === n.tab ? "on" : ""} ${n.wideOnly ? "only-wide" : ""} ${n.secondary ? "secondary" : ""}`} aria-current={route.tab === n.tab ? "page" : undefined}
                title={n.label} onClick={() => go({ tab: n.tab })}>
                <Icon name={n.icon} size={wide ? 20 : 22} /><span className="navlabel">{n.label}</span>
                {n.tab === "inbox" && badge > 0 && <span className="badgecount" aria-label={`${badge} waiting`}>{badge > 99 ? "99+" : badge}</span>}
              </button>
            </span>
          ))}
        </nav>
        <div className="workspace">
          <TabStrip />
          <main className={`content ${flush ? "flush" : ""}`} id="main">
            {route.tab === "home" && <Home />}
            {route.tab === "work" && <Workspace id={route.id} />}
            {route.tab === "projects" && <Projects id={route.id} />}
            {route.tab === "runs" && <Runs id={route.id} />}
            {route.tab === "inbox" && <Inbox sub={route.sub} id={route.id} />}
            {route.tab === "knowledge" && <Knowledge id={route.id} />}
            {route.tab === "graph" && <GraphScreen id={route.id} />}
            {route.tab === "insights" && <InsightsScreen />}
            {route.tab === "ais" && <MyAIs section={route.id} />}
            {route.tab === "settings" && <Settings section={route.id} />}
          </main>
        </div>
        {wide && <StatusBar pendingDrafts={pending} />}
        <Palette commands={commands} />
        <ShortcutsHelp />
        <Toast />
      </div>
    </AppContext.Provider>
  );
}
