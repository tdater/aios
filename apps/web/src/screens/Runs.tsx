import { useEffect, useRef, useState } from "react";
import { ApiError } from "../core/client";
import { LinkState, monitorRun } from "../core/monitor";
import { Artifact, Paged, Run, RunDetail } from "../core/types";
import { useApp } from "../ui/Context";
import { go, useLoad, useViewport } from "../ui/hooks";
import { Badge, Btn, Collapsible, Empty, ErrorBox, Loading, Notice, Untrusted, ago, fmtLocal, useOnce } from "../ui/kit";

const FILTERS = [["", "All"], ["running", "Running"], ["blocked", "Blocked"], ["awaiting_approval", "Awaiting approval"], ["failed", "Failed"], ["succeeded", "Completed"]];

export function Runs({ id }: { id?: string }) {
  const { twoPane } = useViewport();
  if (twoPane) {
    return (
      <div className="panes">
        <div className="pane-list"><RunList selected={id} /></div>
        <div className="pane-detail">{id ? <RunDetailView id={id} /> : <Empty>Select a run to see its timeline.</Empty>}</div>
      </div>
    );
  }
  return id ? <RunDetailView id={id} /> : <RunList />;
}

function RunList({ selected }: { selected?: string }) {
  const { client } = useApp();
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [items, setItems] = useState<Run[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const first = useLoad(async () => {
    const r = await client.get<Paged<Run>>("/runs", { query: { q, state, limit: 20 } });
    setItems(r.items); setCursor(r.next_cursor);
    return r;
  }, [client, q, state], 4000);
  const more = useOnce(async () => {
    if (!cursor) return;
    const r = await client.get<Paged<Run>>("/runs", { query: { q, state, limit: 20, cursor } });
    setItems((x) => [...x, ...r.items]); setCursor(r.next_cursor);
  });
  return (
    <div className="screen">
      <h2>Runs</h2>
      <label className="field"><span>Search runs</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="chips" role="group" aria-label="Filter by state">
        {FILTERS.map(([v, l]) => <button key={v} className={`chip btnchip ${state === v ? "on" : ""}`} aria-pressed={state === v} onClick={() => setState(v)}>{l}</button>)}
      </div>
      <ErrorBox msg={first.error} code={first.errorCode} />
      {first.loading && !items.length ? <Loading /> : !items.length && !first.error ? <Empty>No runs.</Empty> : (
        <ul className="cards">{items.map((r) => (
          <li key={r.id}><button className={`card-btn ${selected === r.id ? "sel" : ""}`} onClick={() => go({ tab: "runs", id: r.id })}>
            <span className="row"><strong>{r.task_title}</strong><Badge s={r.display_state} /></span>
            <span className="muted small">{r.project_name ?? "no project"} · {r.task_kind} · {ago(r.created_at)}</span>
            {r.cancellation?.status === "requested" && <span className="muted small">cancellation requested</span>}
          </button></li>))}</ul>
      )}
      {cursor && <Btn kind="ghost" busy={more.busy} onClick={() => void more.run()}>Load more</Btn>}
    </div>
  );
}

const LINK_TEXT: Record<LinkState, string> = {
  live: "Live", reconnecting: "Reconnecting… showing the last data received", ended: "Finished", unauthenticated: "Signed out", error: "Monitoring stopped",
};

export function RunDetailView({ id }: { id: string }) {
  const { client, connected } = useApp();
  const [d, setD] = useState<RunDetail | null>(null);
  const [events, setEvents] = useState<RunDetail["events"]>([]);
  const [link, setLink] = useState<LinkState>("live");
  const [linkInfo, setLinkInfo] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

  useEffect(() => {
    setD(null); setEvents([]); setErr(null);
    return monitorRun(client, id, {
      onSnapshot: (s) => { setD(s); setEvents(s.events); setLoadedAt(new Date().toISOString()); },
      onEvents: (items) => setEvents((cur) => { const seen = new Set(cur.map((e) => e.id)); return [...cur, ...items.filter((e) => !seen.has(e.id))]; }),
      onLink: (s, info) => { setLink(s); setLinkInfo(info ?? ""); if (s !== "reconnecting") setLoadedAt(new Date().toISOString()); },
    });
  }, [client, id]);

  if (!d) return <div className="screen"><Btn kind="ghost" onClick={() => history.back()}>← Runs</Btn>{link === "error" || link === "unauthenticated" ? <ErrorBox msg={linkInfo || LINK_TEXT[link]} /> : <Loading what="Loading run" />}</div>;
  const r = d.run;
  const open = ["queued", "running", "awaiting_approval", "blocked", "interrupted"].includes(r.state);
  return (
    <div className="screen">
      <Btn kind="ghost" onClick={() => history.back()}>← Runs</Btn>
      <div className="row"><h2>{r.task_title}</h2><Badge s={r.display_state} /></div>
      <p className={`muted small link ${link}`} role="status">{LINK_TEXT[link]}{link === "reconnecting" ? ` (${linkInfo})` : ""} · last synced {ago(loadedAt)}</p>
      {link === "reconnecting" && <Notice tone="warn">Connection lost. The status below is from {ago(loadedAt)} and may be out of date. It will resynchronise automatically.</Notice>}
      {r.state_reason && <p>{r.state_reason}</p>}
      <p className="muted small">attempt {r.attempt}/{r.max_attempts} · iteration {r.iteration}/{r.max_iterations} · v{r.version} · created {fmtLocal(r.created_at)}</p>
      <ErrorBox msg={err} />
      <CancelPanel run={r} open={open} connected={connected} onError={setErr} onDone={(x) => setD(x)} />
      {r.state === "blocked" && (r.block_code === "awaiting_provider_session") && <ImportPanel runId={id} packets={d.artifacts.filter((a) => a.kind === "task_packet")} onError={setErr} />}
      {(r.state === "blocked" || r.state === "interrupted") && r.block_code !== "uncertain_side_effect" && r.block_code !== "provider_unavailable" && r.block_code !== "quota_exhausted" && (
        <ResumeButton runId={id} connected={connected} onError={setErr} />
      )}
      {r.block_code === "uncertain_side_effect" && <Notice tone="bad">A step with external side effects was interrupted and its outcome is unknown. It will not be repeated automatically. Verify it on the server before resuming.</Notice>}
      <Collapsible title="Timeline" startOpen count={events.length}>
        <ol className="timeline">{events.map((e) => <li key={e.id}><span className="muted small">{new Date(e.ts).toLocaleTimeString()}</span> <code>{e.kind}</code> {e.message}</li>)}</ol>
      </Collapsible>
      <Collapsible title="Steps" startOpen count={d.steps.length}>
        {d.steps.length === 0 ? <Empty>No steps recorded.</Empty> : <ul className="plain">{d.steps.map((s) => (
          <li key={s.id}>{s.seq}. {s.name}{s.side_effect ? " ⚠ side effect" : ""} <Badge s={s.state === "done" ? "completed" : s.state === "started" ? "running" : s.state} />{s.error && <div className="muted small">{s.error}</div>}</li>))}</ul>}
      </Collapsible>
      <Collapsible title="Verification & evidence" startOpen count={d.evidence.length}>
        {d.evidence.length === 0 ? <Empty>No evidence recorded.</Empty> : <ul className="plain">{d.evidence.map((e) => <li key={e.id}><code>{e.kind}</code> {e.summary}</li>)}</ul>}
      </Collapsible>
      <Collapsible title="Artifacts" count={d.artifacts.length}>
        {d.artifacts.length === 0 ? <Empty>No artifacts.</Empty> : d.artifacts.map((a) => <ArtifactView key={a.id} a={a} />)}
      </Collapsible>
    </div>
  );
}

function CancelPanel({ run, open, connected, onError, onDone }: { run: Run; open: boolean; connected: boolean; onError: (s: string | null) => void; onDone: (d: RunDetail) => void }) {
  const { client } = useApp();
  const c = run.cancellation;
  const [confirm, setConfirm] = useState(false);
  const cancel = useOnce(async () => {
    onError(null);
    try {
      await client.post(`/runs/${run.id}/cancel`, { expected_version: run.version });
      setConfirm(false);
      onDone(await client.get<RunDetail>(`/runs/${run.id}`));
    } catch (e) {
      onError(e instanceof ApiError && e.code === "version_conflict" ? "This run changed since you opened it. Review the current state, then try again." : e instanceof Error ? e.message : String(e));
      onDone(await client.get<RunDetail>(`/runs/${run.id}`).catch(() => null as never));
    }
  });
  if (c && c.status !== "none") {
    return (
      <Notice tone={c.status === "confirmed" ? "ok" : c.status === "too_late" ? "info" : "warn"}>
        <strong>{c.status === "requested" ? "Cancellation requested — not yet complete" : c.status === "confirmed" ? "Cancellation confirmed" : "Cancellation came too late: the run had already finished"}</strong>
        {c.status === "requested" && <div>The run stops at its next step boundary.{c.in_flight_step ? ` The step “${c.in_flight_step.step}”${c.in_flight_step.side_effect ? " (it has external side effects)" : ""} is in flight and may still finish.` : ""}</div>}
        <div className="small">{c.note}</div>
      </Notice>
    );
  }
  if (!open) return null;
  return confirm ? (
    <Notice tone="warn">
      Request cancellation? {run.state === "running" ? "The run will stop at its next step boundary; a step already in flight may still finish." : "This run is not executing, so it will stop immediately."} Completed side effects are not undone.
      <div className="row"><Btn kind="danger" busy={cancel.busy} disabled={!connected} onClick={() => void cancel.run()}>Yes, request cancellation</Btn><Btn kind="ghost" onClick={() => setConfirm(false)}>Keep running</Btn></div>
    </Notice>
  ) : <Btn kind="ghost" disabled={!connected} onClick={() => setConfirm(true)}>Request cancellation…</Btn>;
}

function ResumeButton({ runId, connected, onError }: { runId: string; connected: boolean; onError: (s: string | null) => void }) {
  const { client } = useApp();
  const resume = useOnce(async () => {
    onError(null);
    try { await client.post(`/runs/${runId}/resume`); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  });
  return <Btn kind="ghost" busy={resume.busy} disabled={!connected} onClick={() => void resume.run()}>Resume run</Btn>;
}

function ImportPanel({ runId, packets, onError }: { runId: string; packets: RunDetail["artifacts"]; onError: (s: string | null) => void }) {
  const { client, connected } = useApp();
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [packet, setPacket] = useState<Artifact | null>(null);
  const imp = useOnce(async () => {
    onError(null);
    try { await client.post(`/runs/${runId}/import-result`, { text, source }); setText(""); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  });
  return (
    <div className="card">
      <h3>Waiting for your provider session</h3>
      <p className="muted small">AIOS does not drive Claude or Gemini itself. Run the task packet in a session you start, then paste the result here. It is stored as an <strong>unverified claim</strong>.</p>
      {packets[0] && <Btn kind="ghost" onClick={async () => setPacket(await client.get<Artifact>(`/artifacts/${packets[0].id}`))}>View task packet</Btn>}
      {packet && <Untrusted text={packet.content} />}
      <label className="field"><span>Source (e.g. “Claude Code session”)</span><input value={source} onChange={(e) => setSource(e.target.value)} /></label>
      <label className="field"><span>Result</span><textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <Btn busy={imp.busy} disabled={!connected || !text || !source} onClick={() => void imp.run()}>Import result</Btn>
    </div>
  );
}

function ArtifactView({ a }: { a: RunDetail["artifacts"][number] }) {
  const { client } = useApp();
  const [art, setArt] = useState<Artifact | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="card-static">
      <div className="row"><strong>{a.kind}</strong><span className="muted small">{a.provenance}</span></div>
      <p className="muted small">sha256 {a.sha256.slice(0, 16)}… · {a.bytes} bytes · secrets redacted</p>
      <ErrorBox msg={err} />
      {art ? <Untrusted text={art.content} /> : <Btn kind="ghost" onClick={async () => { try { setArt(await client.get<Artifact>(`/artifacts/${a.id}`)); } catch (e) { setErr((e as Error).message); } }}>Show content</Btn>}
    </div>
  );
}
