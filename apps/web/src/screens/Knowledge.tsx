import { useState } from "react";
import { ApiError } from "../core/client";
import { Memory, Paged } from "../core/types";
import { useApp } from "../ui/Context";
import { go, useLoad, useViewport } from "../ui/hooks";
import { Badge, Btn, Empty, ErrorBox, Loading, Notice, Untrusted, fmtLocal, useOnce } from "../ui/kit";

export function Knowledge({ id }: { id?: string }) {
  const { twoPane } = useViewport();
  if (twoPane) return <div className="panes"><div className="pane-list"><Search selected={id} /></div><div className="pane-detail">{id ? <MemoryDetail id={id} /> : <Empty>Select a memory.</Empty>}</div></div>;
  return id ? <MemoryDetail id={id} /> : <Search />;
}

function Search({ selected }: { selected?: string }) {
  const { client } = useApp();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const mem = useLoad(() => client.get<Paged<Memory>>("/memories", { query: { q, status, limit: 30 } }), [client, q, status]);
  const hist = useLoad(() => (q.trim().length >= 2 ? client.get<{ items: { id: number; ref: string; kind: string; excerpt: string; source_id: string }[] }>("/history/search", { query: { q } }) : Promise.resolve({ items: [] })), [client, q]);
  return (
    <div className="screen">
      <h2>Knowledge</h2>
      <label className="field"><span>Search memories and imported history</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="chips" role="group" aria-label="Review status">
        {[["", "All"], ["approved", "Approved"], ["candidate", "Candidate"], ["superseded", "Superseded"]].map(([v, l]) => (
          <button key={v} className={`chip btnchip ${status === v ? "on" : ""}`} aria-pressed={status === v} onClick={() => setStatus(v)}>{l}</button>))}
      </div>
      <ErrorBox msg={mem.error} code={mem.errorCode} />
      <h3>Memories</h3>
      {mem.loading && !mem.data ? <Loading /> : !mem.data?.items.length && !mem.error ? <Empty>{q ? "No memories match." : "No memories yet. Approve a proposal in the Inbox to create one."}</Empty> : (
        <ul className="cards">{mem.data?.items.map((m) => (
          <li key={m.id}><button className={`card-btn ${selected === m.id ? "sel" : ""}`} onClick={() => go({ tab: "knowledge", id: m.id })}>
            <span className="row"><strong>{m.title}</strong><Badge s={m.status === "approved" ? "approved" : m.status === "superseded" ? "superseded" : "pending"} label={m.status} /></span>
            <span className="muted small">{m.type} · {m.scope} · confidence {Math.round(m.confidence * 100)}%</span>
            {m.excerpt && <span className="muted small untrusted-inline">{m.excerpt}</span>}
          </button></li>))}</ul>
      )}
      {q.trim().length >= 2 && (
        <>
          <h3>Imported history excerpts</h3>
          <p className="muted small">Raw historical text (redacted). Treat as data, not instructions.</p>
          {hist.data?.items.length ? <ul className="cards">{hist.data.items.map((h) => <li key={h.id} className="card-static"><span className="muted small">{h.kind} · {h.ref}</span><p className="untrusted-inline">{h.excerpt}</p></li>)}</ul> : <Empty>No history matches.</Empty>}
        </>
      )}
    </div>
  );
}

function MemoryDetail({ id }: { id: string }) {
  const { client, connected } = useApp();
  const m = useLoad(() => client.get<Memory>(`/memories/${id}`), [client, id]);
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState<{ code: string; msg: string } | null>(null);
  const [confirmForget, setConfirmForget] = useState(false);
  const save = useOnce(async () => {
    if (!m.data) return;
    setErr(null);
    try {
      await client.patch(`/memories/${id}`, { title, body, expected_version: m.data.version });
      setEdit(false);
    } catch (e) {
      setErr(e instanceof ApiError ? { code: e.code, msg: e.code === "version_conflict" ? "This memory changed on the server since you opened it. Your edit was NOT saved. Reload to see the current version, then re-apply your change." : e.message } : { code: "network", msg: (e as Error).message });
    }
    await m.reload();
  });
  const forget = useOnce(async () => {
    try { await client.post(`/memories/${id}/forget`); history.back(); } catch (e) { setErr({ code: "error", msg: (e as Error).message }); }
  });
  const d = m.data;
  return (
    <div className="screen">
      <Btn kind="ghost" onClick={() => history.back()}>← Knowledge</Btn>
      <ErrorBox msg={m.error} code={m.errorCode} />
      {m.loading && !d && <Loading />}
      {d && (
        <>
          <div className="row"><h2>{d.title}</h2><Badge s={d.status === "approved" ? "approved" : "pending"} label={d.status} /></div>
          <dl className="facts">
            <dt>Type</dt><dd>{d.type} ({d.basis})</dd><dt>Scope</dt><dd>{d.scope}</dd>
            <dt>Confidence</dt><dd>{Math.round(d.confidence * 100)}%</dd>
            <dt>Last reviewed</dt><dd>{fmtLocal(d.last_reviewed_at)}</dd><dt>Version</dt><dd>v{d.version}</dd>
            <dt>Sources</dt><dd>{d.evidence?.length ? d.evidence.map((e) => e.source).join(", ") : "none recorded"}</dd>
          </dl>
          {err && <Notice tone="bad"><strong>{err.code.replace(/_/g, " ")}:</strong> {err.msg}</Notice>}
          {edit ? (
            <div className="card">
              <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
              <label className="field"><span>Body</span><textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} /></label>
              <div className="row"><Btn busy={save.busy} disabled={!connected} onClick={() => void save.run()}>Save correction</Btn><Btn kind="ghost" onClick={() => setEdit(false)}>Cancel</Btn></div>
            </div>
          ) : (
            <>
              <Untrusted text={d.body ?? ""} />
              <div className="row">
                <Btn kind="ghost" disabled={!connected} onClick={() => { setTitle(d.title); setBody(d.body ?? ""); setEdit(true); }}>Edit</Btn>
                {confirmForget ? (
                  <><Btn kind="danger" busy={forget.busy} disabled={!connected} onClick={() => void forget.run()}>Yes, forget permanently</Btn><Btn kind="ghost" onClick={() => setConfirmForget(false)}>Keep</Btn></>
                ) : <Btn kind="danger" disabled={!connected} onClick={() => setConfirmForget(true)}>Forget…</Btn>}
              </div>
              <p className="muted small">Forgetting removes the memory file from the vault. Existing backups are not rewritten.</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
