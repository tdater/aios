import { useEffect, useState } from "react";
import { ApiError, NetworkError, newKey } from "../core/client";
import { Draft } from "../core/drafts";
import { Home as HomeData } from "../core/types";
import { useApp } from "../ui/Context";
import { go, useLoad } from "../ui/hooks";
import { Badge, Btn, Empty, ErrorBox, Loading, Notice, ago, fmtLocal, useOnce } from "../ui/kit";

export function Home() {
  const app = useApp();
  const { client, connected, partition, cache, drafts } = app;
  const home = useLoad(() => client.get<HomeData>("/home"), [client], 5000);
  const [, bump] = useState(0);
  const cached = cache.get<{ counts: HomeData["counts"]; runs: { id: string; title: string; state: string }[] }>(partition, "home");

  useEffect(() => {
    if (home.data)
      cache.put(partition, "home", {
        counts: home.data.counts,
        runs: [...home.data.current_runs, ...home.data.blocked_runs].map((r) => ({ id: r.id, title: r.task_title, state: r.display_state })),
      });
  }, [home.data, cache, partition]);

  const list = drafts.list(partition);
  const pending = list.filter((d) => d.status !== "sent");

  return (
    <div className="screen">
      <h2>Home</h2>
      <ConnectionCard />
      <button className="card-btn startwork" onClick={() => go({ tab: "work" })}>
        <strong>Workspace</strong>
        <span className="muted small">Talk to Claude about a project, review the changes it makes, and check them with your tests.</span>
      </button>
      {home.error && !home.data && (
        <>
          <ErrorBox msg={home.error} code={home.errorCode} />
          {cached && (
            <Notice tone="info">
              Offline summary from {fmtLocal(cached.at)} ({ago(cached.at)}). This is NOT current status: runs may have changed.
              <ul>{cached.value.runs.map((r) => <li key={r.id}>{r.title} — {r.state} <em>(as of last sync)</em></li>)}</ul>
            </Notice>
          )}
        </>
      )}
      {home.loading && !home.data && <Loading />}
      {home.data && (
        <>
          <div className="stats" role="group" aria-label="Work summary">
            <Stat label="Running" value={home.data.counts.active_runs} to={{ tab: "runs" }} />
            <Stat label="Blocked" value={home.data.counts.blocked_runs} tone={home.data.counts.blocked_runs ? "warn" : undefined} to={{ tab: "runs" }} />
            <Stat label="Approvals" value={home.data.counts.pending_approvals} tone={home.data.counts.pending_approvals ? "warn" : undefined} to={{ tab: "inbox" }} />
            <Stat label="To review" value={home.data.counts.pending_candidates} to={{ tab: "inbox" }} />
          </div>
          <p className="muted small">Updated {ago(home.at?.toISOString())} · server time {fmtLocal(home.data.server_time)}</p>
          {home.error && <Notice tone="warn">Could not refresh ({home.error}). Showing the last data received {ago(home.at?.toISOString())}.</Notice>}
          <h3>Current runs</h3>
          {home.data.current_runs.length === 0 ? <Empty>Nothing is running.</Empty> : (
            <ul className="cards">{home.data.current_runs.map((r) => <RunRow key={r.id} r={r} />)}</ul>
          )}
          <h3>Blocked work</h3>
          {home.data.blocked_runs.length === 0 ? <Empty>Nothing is blocked.</Empty> : (
            <ul className="cards">{home.data.blocked_runs.map((r) => <RunRow key={r.id} r={r} showReason />)}</ul>
          )}
          <h3>Providers</h3>
          <div className="chips">
            {home.data.providers.map((p) => (
              <span key={p.provider} className="chip" title={`billing: ${p.billing}`}>{p.provider}: <Badge s={p.mode === "unavailable" ? "failed" : p.mode === "automated" ? "completed" : "pending"} label={p.mode.replace("_", " ")} /></span>
            ))}
          </div>
        </>
      )}
      <QuickCapture onChange={() => bump((n) => n + 1)} />
      <DraftList drafts={list} pending={pending.length} onChange={() => bump((n) => n + 1)} />
    </div>
  );
}

function Stat({ label, value, tone, to }: { label: string; value: number; tone?: string; to: { tab: "runs" | "inbox" } }) {
  return (
    <button className={`stat ${tone ?? ""}`} onClick={() => go(to)} aria-label={`${label}: ${value}`}>
      <span className="stat-n">{value}</span><span className="stat-l">{label}</span>
    </button>
  );
}

export function RunRow({ r, showReason }: { r: HomeData["current_runs"][number]; showReason?: boolean }) {
  return (
    <li>
      <button className="card-btn" onClick={() => go({ tab: "runs", id: r.id })}>
        <span className="row"><strong>{r.task_title}</strong><Badge s={r.display_state} /></span>
        {showReason && r.state_reason && <span className="muted small">{r.state_reason}</span>}
        <span className="muted small">{r.task_kind} · {ago(r.created_at)}</span>
      </button>
    </li>
  );
}

function ConnectionCard() {
  const { conn, server } = useApp();
  const label = { connected: "Connected", connecting: "Connecting…", stale: "Stale", disconnected: "Disconnected",
    incompatible: "Incompatible", unauthenticated: "Signed out" }[conn.state];
  return (
    <div className={`conn ${conn.state}`} role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      <div>
        <strong>{label}</strong> · {server.label}
        <div className="muted small">
          {conn.state === "connected" ? `Server ${conn.meta?.server_version} · API ${conn.meta?.api_version} · checked ${ago(conn.lastOkAt)}`
            : `${conn.detail ?? ""} Last contact ${ago(conn.lastOkAt)}. Status shown may be out of date.`}
        </div>
      </div>
    </div>
  );
}

function QuickCapture({ onChange }: { onChange: () => void }) {
  const { client, connected, partition, drafts } = useApp();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "bad"; t: string } | null>(null);
  const save = useOnce(async () => {
    const t = text.trim();
    if (!t) return;
    setMsg(null);
    // Always create a local draft first (with its idempotency key). Sending is a separate, explicit step.
    const d = drafts.add(partition, t);
    setText("");
    if (!connected) {
      setMsg({ tone: "warn", t: "Saved as a local draft (not sent). It will not be sent until you choose to." });
    } else {
      const r = await drafts.send(partition, client, d.id);
      if (r.status === "sent") drafts.remove(partition, d.id);   // server has it; keep nothing locally
      setMsg(r.status === "sent" ? { tone: "ok", t: "Captured on the server." } : { tone: r.status === "failed" || r.status === "conflict" ? "bad" : "warn", t: r.error ?? r.status });
    }
    onChange();
  });
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); void save.run(); }} aria-label="Quick capture">
      <h3>Quick capture</h3>
      <label className="field"><span>Idea or task</span>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="What should AIOS remember or do?" />
      </label>
      {msg && <Notice tone={msg.tone}>{msg.t}</Notice>}
      <Btn type="submit" busy={save.busy} disabled={!text.trim()}>{connected ? "Capture" : "Save draft"}</Btn>
    </form>
  );
}

function DraftList({ drafts: list, pending, onChange }: { drafts: Draft[]; pending: number; onChange: () => void }) {
  const { client, connected, partition, drafts, settings } = useApp();
  const [err, setErr] = useState<string | null>(null);
  const sendAll = useOnce(async () => {
    setErr(null);
    await drafts.sendMany(partition, client, list.filter((d) => d.status !== "sent" && d.status !== "conflict").map((d) => d.id));
    onChange();
  });
  const sendOne = useOnce(async (id: string) => { await drafts.send(partition, client, id); onChange(); });
  if (!list.length) return null;
  return (
    <div className="card">
      <h3>Local drafts <span className="badge warn">{pending} pending sync</span></h3>
      <p className="muted small">Drafts live only on this device. They are not tasks until you send them.</p>
      {connected && pending > 0 && settings.draftPolicy === "ask_on_reconnect" && (
        <Notice tone="info">You are back online with {pending} unsent draft(s). Review and send when ready.</Notice>
      )}
      <ErrorBox msg={err} />
      <ul className="cards">
        {list.map((d) => (
          <li key={d.id} className="card-static">
            <div className="row"><Badge s={d.status === "sent" ? "completed" : d.status === "draft" ? "pending" : d.status === "conflict" || d.status === "failed" ? "failed" : "pending"} label={d.status.replace("_", " ")} /><span className="muted small">{ago(d.createdAt)}</span></div>
            <p className="untrusted-inline">{d.text}</p>
            {d.error && <p className="muted small">{d.error}</p>}
            <div className="row">
              {d.status !== "sent" && <Btn kind="ghost" busy={sendOne.busy} disabled={!connected || d.status === "conflict"} onClick={() => void sendOne.run(d.id)}>Send</Btn>}
              <Btn kind="ghost" onClick={() => { drafts.remove(partition, d.id); onChange(); }}>{d.status === "sent" ? "Dismiss" : "Discard"}</Btn>
            </div>
          </li>
        ))}
      </ul>
      {pending > 1 && <Btn busy={sendAll.busy} disabled={!connected} onClick={() => void sendAll.run()}>Send all ({pending})</Btn>}
      {!connected && <p className="muted small">Reconnect to send. Nothing is uploaded automatically.</p>}
    </div>
  );
}
