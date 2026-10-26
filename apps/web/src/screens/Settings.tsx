import { useEffect, useState } from "react";
import { MODES, Tab, hideable } from "../core/modes";
import { ACCENTS, THEME_MODES } from "../core/settings";
import { APP_VERSION, API_VERSION, Provider, SessionInfo } from "../core/types";
import { useApp } from "../ui/Context";
import { Icon } from "../ui/icons";
import { useLoad } from "../ui/hooks";
import { HistorySection } from "./settings/History";
import { PublishSection } from "./settings/Publish";
import { Badge, Btn, Empty, ErrorBox, Loading, Notice, ago, fmtLocal, useOnce } from "../ui/kit";

interface Health { version: string; db: string; schema: string[]; run_counts: Record<string, number>; disk_free_gb: number; backup_status: string; billable_env: Record<string, string[]> }

export function Settings({ section }: { section?: string }) {
  useEffect(() => {                           // #/settings/history jumps straight to the history section
    if (section) setTimeout(() => document.getElementById(section)?.scrollIntoView?.({ block: "start" }), 60);
  }, [section]);
  return (
    <div className="screen">
      <h2>Settings</h2>
      <AppearanceSection />
      <HistorySection />
      <PublishSection />
      <ServerSection />
      <SessionSection />
      <PrivacySection />
      <section className="card">
        <h3>Notifications</h3>
        <Notice tone="info">Push notifications are <strong>not enabled</strong>. This version has an in-app inbox only and does no background polling, so nothing will alert you while the app is closed. Pushes would need an external service and your approval first.</Notice>
      </section>
      <Diagnostics />
    </div>
  );
}

function AppearanceSection() {
  const { settings, updateSettings } = useApp();
  const custom = settings.accent !== "default" && !ACCENTS.some((a) => a.hex.toLowerCase() === settings.accent.toLowerCase());
  return (
    <section className="card" aria-labelledby="appearance-h">
      <h3 id="appearance-h">Appearance</h3>
      <div className="field"><span>Theme</span>
        <div className="themegrid" role="group" aria-label="Theme">
          {THEME_MODES.map((t) => (
            <button key={t.id} className="themecard" aria-pressed={settings.theme === t.id} onClick={() => updateSettings({ theme: t.id })}>
              <strong>{t.label}</strong><small>{t.hint}</small>
            </button>))}
        </div>
      </div>
      <div className="field"><span>Accent colour</span>
        <div className="swatches" role="group" aria-label="Accent colour">
          <button className="swatch" style={{ background: "var(--accent)", backgroundImage: "linear-gradient(135deg, transparent 45%, var(--bg) 45% 55%, transparent 55%)" }}
            aria-pressed={settings.accent === "default"} aria-label="Theme default accent" title="Theme default" onClick={() => updateSettings({ accent: "default" })} />
          {ACCENTS.map((a) => (
            <button key={a.id} className="swatch" style={{ background: a.hex }} aria-pressed={settings.accent.toLowerCase() === a.hex.toLowerCase()} aria-label={a.label} title={a.label}
              onClick={() => updateSettings({ accent: a.hex })} />))}
          <label className="swatch" style={{ display: "grid", placeItems: "center", background: custom ? settings.accent : "var(--panel2)", overflow: "hidden", position: "relative" }} title="Custom colour">
            <span className="sr">Custom accent colour</span>
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(settings.accent) ? settings.accent : "#8b7cf6"} onChange={(e) => updateSettings({ accent: e.target.value })}
              style={{ opacity: 0, position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "pointer" }} />
            {!custom && <Icon name="plus" size={16} />}
          </label>
        </div>
      </div>
      <label className="field"><span>Text size: {settings.fontSize}px</span>
        <input type="range" min={14} max={20} step={1} value={settings.fontSize} onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })} aria-label="Text size" /></label>
      <label className="field"><span>Note font</span>
        <select value={settings.noteFont} onChange={(e) => updateSettings({ noteFont: e.target.value as "sans" | "serif" })}>
          <option value="sans">Sans-serif (interface font)</option><option value="serif">Serif (book-like)</option></select></label>
      <fieldset className="field"><legend>How much to show</legend>
        {MODES.map((m) => (
          <label key={m.id} className="check"><input type="radio" name="mode" checked={settings.mode === m.id} onChange={() => updateSettings({ mode: m.id })} /> <strong>{m.label}</strong> <span className="muted small">{m.hint}</span></label>))}
        <p className="muted small">Nothing is deleted when you change this. Hidden sections are still reachable from the command palette.</p>
        {hideable(settings.mode).map((t) => (
          <label key={t} className="check"><input type="checkbox" checked={!settings.hiddenNav.includes(t)}
            onChange={(e) => updateSettings({ hiddenNav: e.target.checked ? settings.hiddenNav.filter((x) => x !== t) : [...settings.hiddenNav, t] })} /> Show {TAB_NAMES[t]} in the menu</label>))}
      </fieldset>
      <label className="field"><span>Spacing</span>
        <select value={settings.density} onChange={(e) => updateSettings({ density: e.target.value as "comfortable" | "compact" })}>
          <option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
      <label className="check"><input type="checkbox" checked={settings.readableLine} onChange={(e) => updateSettings({ readableLine: e.target.checked })} /> Readable line length in notes</label>
      <label className="check"><input type="checkbox" checked={settings.tabs} onChange={(e) => updateSettings({ tabs: e.target.checked })} /> Show document tabs (tablet and desktop)</label>
      <label className="check"><input type="checkbox" checked={settings.statusBar} onChange={(e) => updateSettings({ statusBar: e.target.checked })} /> Show status bar (tablet and desktop)</label>
      <label className="check"><input type="checkbox" checked={settings.reduceMotion === "on"} onChange={(e) => updateSettings({ reduceMotion: e.target.checked ? "on" : "system" })} /> Reduce motion (otherwise follows your device)</label>
    </section>
  );
}

const TAB_NAMES: Record<Tab, string> = { home: "Home", work: "Workspace", projects: "Projects", runs: "Runs", inbox: "Inbox", insights: "Insights", knowledge: "Knowledge", graph: "Graph", settings: "Settings" };

function ServerSection() {
  const { registry, server, switchServer, removeServer, isNative } = useApp();
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <section className="card">
      <h3>Server</h3>
      <ul className="cards">
        {registry.list().map((s) => (
          <li key={s.id} className="card-static">
            <div className="row"><strong>{s.label}</strong>{s.id === server.id && <Badge s="completed" label="active" />}</div>
            <div className="muted small">{s.url || "this site (same origin)"} {s.serverId ? `· id ${s.serverId.slice(0, 12)}…` : ""}</div>
            <div className="row">
              {s.id !== server.id && <Btn kind="ghost" onClick={() => switchServer(s.id)}>Switch</Btn>}
              {confirm === s.id ? <><Btn kind="danger" onClick={() => void removeServer(s.id)}>Remove + wipe its local data</Btn><Btn kind="ghost" onClick={() => setConfirm(null)}>Cancel</Btn></> : <Btn kind="ghost" onClick={() => setConfirm(s.id)}>Remove…</Btn>}
            </div>
          </li>))}
      </ul>
      {isNative ? <Btn kind="ghost" onClick={() => switchServer(null)}>Add another server</Btn> : <p className="muted small">The browser app talks only to the site it was loaded from.</p>}
    </section>
  );
}

function SessionSection() {
  const { client, signOut, connected } = useApp();
  const l = useLoad(() => client.get<{ items: SessionInfo[] }>("/auth/sessions"), [client]);
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const revoke = useOnce(async (id: string) => { try { await client.post(`/auth/sessions/${id}/revoke`); } catch (e) { setErr((e as Error).message); } await l.reload(); });
  const mk = useOnce(async () => { try { setCode((await client.post<{ code: string; expires_at: string }>("/auth/pairing-codes")).data); } catch (e) { setErr((e as Error).message); } });
  return (
    <section className="card">
      <h3>Session &amp; devices</h3>
      <ErrorBox msg={err ?? l.error} />
      {l.loading && !l.data ? <Loading /> : (
        <ul className="cards">{l.data?.items.filter((s) => !s.revoked_at).map((s) => (
          <li key={s.id} className="card-static">
            <div className="row"><strong>{s.device_name}</strong>{s.current && <Badge s="completed" label="this device" />}<span className="muted small">{s.kind}</span></div>
            <div className="muted small">last active {ago(s.last_seen_at)} · expires {fmtLocal(s.expires_at)}</div>
            {!s.current && <Btn kind="danger" busy={revoke.busy} disabled={!connected} onClick={() => void revoke.run(s.id)}>Revoke</Btn>}
          </li>))}</ul>
      )}
      <div className="row"><Btn kind="ghost" onClick={() => void signOut()}>Sign out this device</Btn>
        <Btn kind="ghost" busy={mk.busy} disabled={!connected} onClick={() => void mk.run()}>Pair another device</Btn></div>
      {code && <Notice tone="info">Code <strong className="code">{code.code}</strong> — single use, expires {fmtLocal(code.expires_at)}.</Notice>}
    </section>
  );
}

function PrivacySection() {
  const { settings, updateSettings, cache, drafts, partition, clearLocalData } = useApp();
  const [done, setDone] = useState<string | null>(null);
  return (
    <section className="card">
      <h3>Cache &amp; privacy</h3>
      <label className="check"><input type="checkbox" checked={settings.cacheEnabled} onChange={(e) => { updateSettings({ cacheEnabled: e.target.checked }); if (!e.target.checked) { cache.clearAll(); setDone("Cached summaries cleared."); } }} />
        Keep non-secret summaries (project names, run titles and states) for offline viewing</label>
      <p className="muted small">Off by default. Never cached: approvals, logs, artifacts, memory text, tokens. Cached data is labelled with its age and is never presented as current.</p>
      <label className="field"><span>Drafts after reconnecting</span>
        <select value={settings.draftPolicy} onChange={(e) => updateSettings({ draftPolicy: e.target.value as "manual" | "ask_on_reconnect" })}>
          <option value="ask_on_reconnect">Remind me to review and send</option><option value="manual">Only when I open Home</option></select></label>
      <p className="muted small">There is no automatic upload: drafts are sent only when you press Send.</p>
      {done && <Notice tone="ok">{done}</Notice>}
      <div className="row">
        <Btn kind="ghost" onClick={() => { cache.clearAll(); setDone("Cached summaries cleared."); }}>Clear cached summaries</Btn>
        <Btn kind="ghost" onClick={() => { drafts.clear(partition); setDone("Drafts deleted."); }}>Delete local drafts ({drafts.list(partition).length})</Btn>
        <Btn kind="danger" onClick={clearLocalData}>Wipe all local data</Btn>
      </div>
    </section>
  );
}

function Diagnostics() {
  const { client, conn, partition } = useApp();
  const h = useLoad(() => client.get<Health>("/health"), [client]);
  const p = useLoad(() => client.get<{ items: Provider[] }>("/providers"), [client]);
  const [copied, setCopied] = useState(false);
  const text = () => [
    `AIOS app ${APP_VERSION} (API ${API_VERSION})`,
    `Server ${conn.meta?.server_version ?? "?"} API ${conn.meta?.api_version ?? "?"} id ${partition}`,
    `Connection ${conn.state}, last contact ${conn.lastOkAt ?? "never"}`,
    `Schema ${h.data?.schema.join(",") ?? "?"}  runs ${JSON.stringify(h.data?.run_counts ?? {})}`,
    ...(p.data?.items ?? []).map((x) => `Provider ${x.provider}: ${x.mode} / billing ${x.billing}`),
    "(No tokens, URLs, prompts, logs or secrets are included.)",
  ].join("\n");
  return (
    <section className="card">
      <h3>Diagnostics</h3>
      <dl className="facts">
        <dt>App</dt><dd>{APP_VERSION} · speaks API {API_VERSION}</dd>
        <dt>Server</dt><dd>{conn.meta ? `${conn.meta.server_version} · API ${conn.meta.api_version} (min client ${conn.meta.min_client_api})` : "unknown"}</dd>
        <dt>Connection</dt><dd><Badge s={conn.state === "connected" ? "completed" : conn.state === "stale" ? "pending" : "failed"} label={conn.state} /> last contact {ago(conn.lastOkAt)}</dd>
        <dt>Database</dt><dd>{h.data ? `${h.data.db} · schema ${h.data.schema.at(-1)}` : h.error ?? "…"}</dd>
        <dt>Backup</dt><dd>{h.data?.backup_status ?? "…"}</dd>
      </dl>
      {h.data && Object.keys(h.data.billable_env).length > 0 && <Notice tone="warn">Metered-billing credentials are present in the server environment (names only). AIOS does not use them without opt-in.</Notice>}
      <h4>Providers (what is actually possible)</h4>
      {!p.data?.items.length ? <Empty>No provider data.</Empty> : <ul className="plain">{p.data.items.map((x) => (
        <li key={x.provider}><strong>{x.provider}</strong> <Badge s={x.mode === "unavailable" ? "failed" : x.mode === "automated" ? "completed" : "pending"} label={x.mode.replace("_", " ")} /> billing: {x.billing}
          {typeof x.detail.warning === "string" && <div className="muted small">⚠ {x.detail.warning}</div>}</li>))}</ul>}
      <Btn kind="ghost" onClick={async () => { await navigator.clipboard?.writeText(text()); setCopied(true); }}>Copy diagnostics</Btn>{copied && <span className="muted small"> copied</span>}
    </section>
  );
}
